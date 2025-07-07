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
    startGroup,
    summary
} from '@actions/core'
import { context } from '@actions/github'
import archiver from 'archiver'
import { WritableStreamBuffer } from 'stream-buffers'
import { minimatch } from 'minimatch'
import { glob } from 'glob'

import { decodeMessage, errors, serviceClients, Session, waitForOperation } from '@yandex-cloud/nodejs-sdk'
import { KB, parseMemory } from './memory'
import { lstatSync } from 'node:fs'
import { fromServiceAccountJsonFile } from './service-account-json'
import {
    CreateFunctionMetadata,
    CreateFunctionRequest,
    CreateFunctionVersionMetadata,
    CreateFunctionVersionRequest,
    ListFunctionsRequest
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function_service'
import { Package } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { StorageServiceImpl } from './storage'
import { StorageObject } from './storage/storage-object'
import { SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'
import path from 'node:path'
import { parseLogLevel } from './log-level'
import axios from 'axios'
import { ActionInputs } from './actionInputs'
import { resolveServiceAccountId } from './service-account'
import { createAsyncInvocationConfig } from './async-invocation'
import {
    SecretServiceClient,
    ListVersionsRequest
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret_service'

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
    const functionService = session.client(serviceClients.FunctionServiceClient)

    const res = await functionService.list(
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

        const op = await functionService.create(
            CreateFunctionRequest.fromPartial({
                folderId,
                name: functionName,
                description: `Created from ${repo.owner}/${repo.repo}`
            })
        )
        const finishedOp = await waitForOperation(op, session)
        if (finishedOp.metadata) {
            functionId = decodeMessage<CreateFunctionMetadata>(finishedOp.metadata).functionId
            info(
                `There was no function named '${functionName}' in the folder. So it was created. Id is '${functionId}'`
            )
        } else {
            error(`Failed to create function '${functionName}'`)
            throw new Error('Failed to create function')
        }
    }
    setOutput('function-id', functionId)
    endGroup()
    return functionId
}

// Helper to resolve 'latest' versionId for Lockbox secrets
async function resolveLatestLockboxVersions(session: Session, secrets: Secret[]): Promise<Secret[]> {
    const lockboxClient = session.client(SecretServiceClient)
    const resolved: Secret[] = []
    for (const secret of secrets) {
        if (secret.versionId !== 'latest') {
            resolved.push(secret)
            continue
        }
        // Fetch all versions for the secret
        const resp = await lockboxClient.listVersions(ListVersionsRequest.fromPartial({ secretId: secret.id }))
        if (!resp.versions || resp.versions.length === 0) {
            throw new Error(`No versions found for Lockbox secret: ${secret.id}`)
        }
        // Sort versions by createdAt and take the latest
        const sorted = resp.versions.slice().sort((a, b) => {
            const aDate = a.createdAt ?? new Date(0)
            const bDate = b.createdAt ?? new Date(0)
            return bDate.getTime() - aDate.getTime()
        })
        const latest = sorted[0]
        resolved.push({ ...secret, versionId: latest.id })
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

        const functionService = session.client(serviceClients.FunctionServiceClient)

        //get from bucket if supplied
        if (inputs.bucket) {
            info(`From bucket: "${inputs.bucket}"`)

            request.package = Package.fromJSON({
                bucketName: inputs.bucket,
                objectName: bucketObjectName
            })
        } else {
            // 3.5 mb
            if (fileContents.length > 3670016) {
                throw Error(`Zip file is too big: ${fileContents.length} bytes. Provide bucket name.`)
            }
            request.content = fileContents
        }
        // Create new version
        const operation = await functionService.createVersion(request)
        await waitForOperation(operation, session)

        info('Operation complete')
        let metadata
        if (operation.metadata) {
            metadata = decodeMessage<CreateFunctionVersionMetadata>(operation.metadata)
        } else {
            error(`Failed to create function version`)
            throw new Error('Failed to create function version')
        }
        setOutput('version-id', metadata.functionVersionId)
        return metadata.functionVersionId
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

export async function writeSummary({
    functionName,
    functionId,
    versionId,
    bucket,
    bucketObjectName,
    errorMessage,
    folderId
}: {
    functionName?: string
    functionId?: string
    versionId?: string
    bucket?: string
    bucketObjectName?: string
    errorMessage?: string
    folderId?: string
}) {
    const items: string[] = []
    if (functionName) items.push(`Function Name: ${functionName}`)
    if (functionId && folderId) {
        const url = `https://console.yandex.cloud/folders/${folderId}/functions/functions/${functionId}/overview`
        items.push(`Function ID: <a href="${url}">${functionId}</a>`)
    }
    if (versionId) items.push(`Version ID: ${versionId}`)
    if (bucket) items.push(`Bucket: ${bucket}`)
    if (bucketObjectName) items.push(`Bucket Object: ${bucketObjectName}`)
    if (errorMessage) {
        items.push(`❌ Error: ${errorMessage}`)
    } else {
        items.push('✅ Success')
    }
    if (items.length === 0) return
    await summary.addHeading('Yandex Cloud Function Deployment Summary', 2).addList(items).write()
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
            const serviceAccountJson = fromServiceAccountJsonFile(JSON.parse(ycSaJsonCredentials))
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
            asyncFailureSaName: getInput('async-failure-sa-name', { required: false })
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

export interface ZipInputs {
    include: string[]
    excludePattern: string[]
    sourceRoot: string
}

export async function zipSources(inputs: ZipInputs, archive: archiver.Archiver): Promise<Buffer> {
    startGroup('ZipDirectory')

    try {
        const outputStreamBuffer = new WritableStreamBuffer({
            initialSize: 1000 * KB, // start at 1000 kilobytes.
            incrementAmount: 1000 * KB // grow by 1000 kilobytes each time buffer overflows.
        })

        info('Archive initialize')

        archive.on('entry', e => {
            info(`add: ${e.name}`)
        })

        const workspace = process.env['GITHUB_WORKSPACE'] ?? ''
        archive.pipe(outputStreamBuffer)
        const patterns = parseIgnoreGlobPatterns(inputs.excludePattern)
        const root = path.join(workspace, inputs.sourceRoot)
        const includes = inputs.include.filter(x => x.length > 0)
        for (const include of includes) {
            const pathFromSourceRoot = path.join(root, include)
            const matches = glob.sync(pathFromSourceRoot, { absolute: false })
            for (const match of matches) {
                if (lstatSync(match).isDirectory()) {
                    debug(`match:  dir ${match}`)
                    archive.directory(pathFromSourceRoot, include, data => {
                        const res = !patterns.map(p => minimatch(data.name, p)).some(x => x)
                        return res ? data : false
                    })
                } else {
                    debug(`match: file ${match}`)
                    archive.file(match, { name: path.relative(root, match) })
                }
            }
        }

        await archive.finalize()

        info('Archive finalized')

        outputStreamBuffer.end()
        const buffer = outputStreamBuffer.getContents()
        info('Buffer object created')

        if (!buffer) {
            throw Error('Failed to initialize Buffer')
        }

        return buffer
    } finally {
        endGroup()
    }
}

function parseIgnoreGlobPatterns(patterns: string[]): string[] {
    const result: string[] = []

    for (const pattern of patterns) {
        //only not empty patterns
        if (pattern?.length > 0) {
            result.push(pattern)
        }
    }

    info(`Source ignore pattern: "${JSON.stringify(result)}"`)
    return result
}

export function parseEnvironmentVariables(env: string[]): { [s: string]: string } {
    info(`Environment string: "${env}"`)

    const environment: { [key: string]: string } = {}
    for (const line of env) {
        const [key, value] = line.split(/=(.*)/s)
        environment[key.trim()] = value.trim()
    }

    info(`EnvObject: "${JSON.stringify(environment)}"`)
    return environment
}

export type Secret = {
    environmentVariable: string
    id: string
    versionId: string
    key: string
}

// environmentVariable=id/versionId/key
export function parseLockboxVariables(secrets: string[]): Secret[] {
    info(`Secrets string: "${secrets}"`)
    const secretsArr: Secret[] = []

    for (const line of secrets) {
        const [environmentVariable, values] = line.split('=')
        const [id, versionId, key] = values.split('/')
        // Allow 'latest' as a valid versionId for now
        if (!environmentVariable || !id || !key || !versionId) {
            throw new Error(`Broken reference to Lockbox Secret: ${line}`)
        }
        // Accept 'latest' as versionId, will resolve later
        const secret = { environmentVariable, id, versionId, key } as Secret
        secretsArr.push(secret)
    }

    info(`SecretsObject: "${JSON.stringify(secretsArr)}"`)
    return secretsArr
}

async function exchangeToken(token: string, saId: string): Promise<string> {
    info(`Exchanging token for service account ${saId}`)
    const res = await axios.post(
        'https://auth.yandex.cloud/oauth/token',
        {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            audience: saId,
            subject_token: token,
            subject_token_type: 'urn:ietf:params:oauth:token-type:id_token'
        },
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    )
    if (res.status !== 200) {
        throw new Error(`Failed to exchange token: ${res.status} ${res.statusText}`)
    }
    if (!res.data.access_token) {
        throw new Error(`Failed to exchange token: ${res.data.error} ${res.data.error_description}`)
    }
    info(`Token exchanged successfully`)
    return res.data.access_token
}
