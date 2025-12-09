import {
    debug,
    endGroup,
    error,
    getBooleanInput,
    getIDToken,
    getInput,
    getMultilineInput,
    info,
    setCommandEcho,
    setFailed,
    setOutput,
    startGroup
} from '@actions/core'
import { context } from '@actions/github'

import { errors, Session, waitForOperation } from '@yandex-cloud/nodejs-sdk'
import { functionService } from '@yandex-cloud/nodejs-sdk/serverless-functions-v1'
import { secretService } from '@yandex-cloud/nodejs-sdk/lockbox-v1'
import { StorageServiceImpl } from './storage'
import { StorageObject } from './storage/storage-object'
import { ActionInputs } from './actionInputs'
import { resolveServiceAccountId } from './service-account'
import { createAsyncInvocationConfig } from './async-invocation'
import { SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'
import { createHash } from 'crypto'
import {
    CreateFunctionMetadata,
    CreateFunctionRequest,
    CreateFunctionVersionRequest,
    ListFunctionsRequest
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function_service'
import { GetSecretRequest } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret_service'
import { CreateFunctionVersionMetadata } from '@yandex-cloud/nodejs-sdk/serverless-functions-v1/function_service'
import {
    parseEnvironmentVariables,
    parseLockboxVariables,
    parseLogLevel,
    parseMemory,
    parseMounts,
    parseServiceAccountJsonFile,
    Secret
} from './parse'
import { writeSummary } from './summary'
import { zipSources } from './zip'
import { exchangeToken } from './auth'
import archiver from 'archiver'

async function uploadToS3(
    bucket: string,
    functionId: string,
    sessionConfig: SessionConfig,
    fileContents: Buffer
): Promise<string> {
    const { GITHUB_SHA } = process.env

    if (!GITHUB_SHA) {
        setFailed('Missing GITHUB_SHA')
        throw new Error('Missing GITHUB_SHA')
    }

    //setting object name
    const bucketObjectName = `${functionId}/${GITHUB_SHA}.zip`
    info(`Upload to bucket: "${bucket}/${bucketObjectName}"`)

    const storageService = new StorageServiceImpl(sessionConfig)

    const storageObject = StorageObject.fromBuffer(bucket, bucketObjectName, fileContents)
    await storageService.putObject(storageObject)
    return bucketObjectName
}

async function getOrCreateFunctionId(session: Session, { folderId, functionName }: ActionInputs): Promise<string> {
    startGroup('Find function id')
    const client = session.client(functionService.FunctionServiceClient)

    const res = await client.list(
        ListFunctionsRequest.fromPartial({
            folderId,
            filter: `name = '${functionName}'`
        })
    )
    let functionId: string
    // If there is a function with the provided name in given folder, then return its id
    if (res.functions.length) {
        functionId = res.functions[0].id
        info(`'There is the function named '${functionName}' in the folder already. Its id is '${functionId}'`)
    } else {
        // Otherwise create new a function and return its id.
        const repo = context.repo

        const op = await client.create(
            CreateFunctionRequest.fromPartial({
                folderId,
                name: functionName,
                description: `Created from ${repo.owner}/${repo.repo}`
            })
        )
        const finishedOp = await waitForOperation(op, session)
        if (finishedOp.metadata) {
            const meta = CreateFunctionMetadata.decode(finishedOp.metadata.value)
            functionId = meta.functionId
            info(
                `There was no function named '${functionName}' in the folder. So it was created. Id is '${functionId}'`
            )
        } else {
            error(`Failed to create function '${functionName}'`)
            throw new Error('Failed to create function')
        }
        if (!functionId) throw new Error('Function ID not resolved')
    }
    setOutput('function-id', functionId)
    endGroup()
    return functionId
}

// Helper to resolve 'latest' versionId for Lockbox secrets
async function resolveLatestLockboxVersions(session: Session, secrets: Secret[]): Promise<Secret[]> {
    const lockboxClient = session.client(secretService.SecretServiceClient)
    const resolved: Secret[] = []
    for (const secret of secrets) {
        if (secret.versionId !== 'latest') {
            resolved.push(secret)
            continue
        }
        // Fetch all versions for the secret
        const resp = await lockboxClient.get(GetSecretRequest.fromPartial({ secretId: secret.id }))
        if (!resp.currentVersion) {
            throw new Error(`No current version found for Lockbox secret: ${secret.id}`)
        }
        // Sort versions by createdAt and take the latest

        resolved.push({ ...secret, versionId: resp.currentVersion.id })
    }
    return resolved
}

async function createFunctionVersion(
    session: Session,
    functionId: string,
    fileContents: Buffer,
    bucketObjectName: string,
    inputs: ActionInputs
): Promise<string> {
    // Return versionId
    startGroup('Create function version')
    try {
        info(`Function '${inputs.functionName}' ${functionId}`)

        //convert variables
        info(`Parsed memory: "${inputs.memory}"`)
        info(`Parsed timeout: "${inputs.executionTimeout}"`)

        const serviceAccountId = await resolveServiceAccountId(
            session,
            inputs.folderId,
            inputs.serviceAccount,
            inputs.serviceAccountName
        )

        // Parse and resolve secrets
        let secrets = parseLockboxVariables(inputs.secrets)
        secrets = await resolveLatestLockboxVersions(session, secrets)

        const client = session.client(functionService.FunctionServiceClient)
        const request = CreateFunctionVersionRequest.fromJSON({
            functionId,
            runtime: inputs.runtime,
            entrypoint: inputs.entrypoint,
            resources: {
                memory: inputs.memory
            },
            serviceAccountId,
            description: inputs.description,
            environment: parseEnvironmentVariables(inputs.environment),
            executionTimeout: { seconds: inputs.executionTimeout },
            secrets,
            tag: inputs.tags,
            connectivity: {
                networkId: inputs.networkId
            },
            logOptions: {
                disabled: inputs.logsDisabled,
                logGroupId: inputs.logsGroupId,
                minLevel: inputs.logLevel
            },
            asyncInvocationConfig: await createAsyncInvocationConfig(session, inputs)
        })

        // Add mounts if provided
        if (inputs.mounts && inputs.mounts.length > 0) {
            request.mounts = parseMounts(inputs.mounts)
        }
        //get from bucket if supplied
        if (inputs.bucket) {
            info(`From bucket: "${inputs.bucket}"`)
            const sha256 = createHash('sha256').update(fileContents).digest('hex')
            request.package = { bucketName: inputs.bucket, objectName: bucketObjectName, sha256 }
        } else {
            // 3.5 mb
            if (fileContents.length > 3670016) {
                throw Error(`Zip file is too big: ${fileContents.length} bytes. Provide bucket name.`)
            }
            request.content = fileContents
        }
        // Create new version
        const operation = await client.createVersion(request)
        debug(`Operation created: ${operation.id}`)
        const finishedOp = await waitForOperation(operation, session)
        debug(`Operation finished: ${finishedOp.id}`)
        if (finishedOp.metadata) {
            info(`Function version created: ${finishedOp.id}`)
            const meta = CreateFunctionVersionMetadata.decode(finishedOp.metadata.value)
            setOutput('version-id', meta.functionVersionId)
            return meta.functionVersionId
        } else {
            error(`Failed to create function version`)
            throw new Error('Failed to create function version')
        }
    } catch (err) {
        if ('description' in (err as object)) {
            setFailed((err as { description: string }).description)
        } else {
            setFailed(err as Error)
        }
        throw err
    } finally {
        endGroup()
    }
}

export async function run(): Promise<void> {
    setCommandEcho(true)
    let functionId = ''
    let versionId = ''
    let bucketObjectName = ''
    let errorMessage = ''
    let inputs: ActionInputs | undefined = undefined
    try {
        let sessionConfig: SessionConfig = {}
        const ycSaJsonCredentials = getInput('yc-sa-json-credentials')
        const ycIamToken = getInput('yc-iam-token')
        const ycSaId = getInput('yc-sa-id')
        if (ycSaJsonCredentials !== '') {
            const serviceAccountJson = parseServiceAccountJsonFile(ycSaJsonCredentials)
            info('Parsed Service account JSON')
            sessionConfig = { serviceAccountJson }
        } else if (ycIamToken !== '') {
            sessionConfig = { iamToken: ycIamToken }
            info('Using IAM token')
        } else if (ycSaId !== '') {
            const ghToken = await getIDToken()
            if (!ghToken) {
                throw new Error('No credentials provided')
            }
            const saToken = await exchangeToken(ghToken, ycSaId)
            sessionConfig = { iamToken: saToken }
        } else {
            throw new Error('No credentials')
        }
        const session = new Session(sessionConfig)
        inputs = {
            folderId: getInput('folder-id', { required: true }),
            functionName: getInput('function-name', { required: true }),
            runtime: getInput('runtime', { required: true }),
            entrypoint: getInput('entrypoint', { required: true }),
            memory: parseMemory(getInput('memory', { required: false }) || '128Mb'),
            include: getMultilineInput('include', { required: false }),
            excludePattern: getMultilineInput('exclude', { required: false }),
            sourceRoot: getInput('source-root', { required: false }) || '.',
            executionTimeout: parseInt(getInput('execution-timeout', { required: false }) || '5', 10),
            environment: getMultilineInput('environment', { required: false }),
            serviceAccount: getInput('service-account', { required: false }),
            serviceAccountName: getInput('service-account-name', { required: false }),
            bucket: getInput('bucket', { required: false }),
            description: getInput('description', { required: false }),
            secrets: getMultilineInput('secrets', { required: false }),
            networkId: getInput('network-id', { required: false }),
            tags: getMultilineInput('tags', { required: false }),
            logsDisabled: getBooleanInput('logs-disabled', { required: false }) || false,
            logsGroupId: getInput('logs-group-id', { required: false }),
            logLevel: parseLogLevel(getInput('log-level', { required: false, trimWhitespace: true })),
            async: getBooleanInput('async', { required: false }),
            asyncSaId: getInput('async-sa-id', { required: false }),
            asyncSaName: getInput('async-sa-name', { required: false }),
            asyncRetriesCount: parseInt(getInput('async-retries-count', { required: false }) || '3', 10),
            asyncSuccessYmqArn: getInput('async-success-ymq-arn', { required: false }),
            asyncSuccessSaId: getInput('async-success-sa-id', { required: false }),
            asyncFailureYmqArn: getInput('async-failure-ymq-arn', { required: false }),
            asyncFailureSaId: getInput('async-failure-sa-id', { required: false }),
            asyncSuccessSaName: getInput('async-success-sa-name', { required: false }),
            asyncFailureSaName: getInput('async-failure-sa-name', { required: false }),
            mounts: getMultilineInput('mounts', { required: false })
        }
        info('Function inputs set')
        const archive = archiver('zip', { zlib: { level: 9 } })
        const fileContents = await zipSources(inputs, archive)
        info(`Buffer size: ${Buffer.byteLength(fileContents)}b`)
        functionId = await getOrCreateFunctionId(session, inputs)
        if (inputs.bucket) {
            bucketObjectName = await uploadToS3(inputs.bucket, functionId, sessionConfig, fileContents)
        }
        versionId = await createFunctionVersion(session, functionId, fileContents, bucketObjectName, inputs)
        setOutput('time', new Date().toTimeString())
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err)
        if (err instanceof errors.ApiError) {
            error(`${err.message}\nx-request-id: ${err.requestId}\nx-server-trace-id: ${err.serverTraceId}`)
        }
        setFailed(err as Error)
    } finally {
        await writeSummary({
            functionName: inputs?.functionName,
            functionId,
            versionId,
            bucket: inputs?.bucket,
            bucketObjectName,
            errorMessage,
            folderId: inputs?.folderId
        })
    }
}
