/**
 * Main entry point for Yandex Cloud Serverless Function deployment.
 *
 * Handles authentication (SA JSON, IAM token, WIF), function version creation,
 * S3 uploads, and Lockbox secret resolution.
 *
 * @see {@link https://github.com/yc-actions/yc-sls-function} for usage examples
 * @module
 */

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
import { ActionInputs } from './action-inputs'
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
import {
    ListSecretsRequest,
    ListSecretsResponse
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret_service'
import { Secret as LockboxSecret } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'
import { PromisePool } from '@supercharge/promise-pool'
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

/**
 * Uploads function code zip archive to Yandex Object Storage.
 *
 * Creates object name from function ID and GitHub commit SHA.
 *
 * @param bucket - S3 bucket name
 * @param functionId - Yandex Cloud function ID
 * @param sessionConfig - Session configuration with auth credentials
 * @param fileContents - Zip file buffer to upload
 * @returns Object name in format: `{functionId}/{GITHUB_SHA}.zip`
 * @throws {Error} If GITHUB_SHA environment variable is missing
 */
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

/**
 * Finds existing function by name or creates new one in the folder.
 *
 * Searches for function by exact name match. If not found, creates new function
 * with description linking to GitHub repository.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param inputs - Action inputs containing folderId and functionName
 * @returns Function ID (existing or newly created)
 * @throws {Error} If function creation fails or ID cannot be resolved
 */
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

/**
 * Result type for secret resolution operations
 */
type ResolutionResult =
    | { status: 'success'; secret: Secret }
    | { status: 'fallback'; original: Secret }
    | { status: 'error'; error: Error }

/**
 * Attempts to resolve secrets by their ID using the Lockbox API.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param secrets - Array of secrets to resolve
 * @returns Array of resolution results indicating success, fallback needed, or error
 */
const resolveSecretsById = async (session: Session, secrets: Secret[]): Promise<ResolutionResult[]> => {
    const client = session.client(secretService.SecretServiceClient)
    const { results } = await PromisePool.for(secrets)
        .withConcurrency(5)
        .useCorrespondingResults()
        .process(async (secret): Promise<ResolutionResult> => {
            let lockboxSecret: LockboxSecret
            try {
                lockboxSecret = await client.get({ secretId: secret.id })
            } catch {
                return { status: 'fallback', original: secret }
            }

            if (!lockboxSecret.currentVersion) {
                return {
                    status: 'error',
                    error: new Error(`Secret ${secret.id} has no current version`)
                }
            }
            return {
                status: 'success',
                secret: {
                    ...secret,
                    versionId: lockboxSecret.currentVersion.id
                }
            }
        })
    return results.filter((r): r is ResolutionResult => typeof r !== 'symbol')
}

/**
 * Lists all secrets in a folder and returns them as a map keyed by secret name.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param folderId - Yandex Cloud folder ID
 * @returns Map of secret names to secret metadata
 */
const findSecretsInFolder = async (session: Session, folderId: string): Promise<Map<string, LockboxSecret>> => {
    const client = session.client(secretService.SecretServiceClient)
    const folderSecretsMap = new Map<string, LockboxSecret>()
    let pageToken: string | undefined = undefined

    do {
        const resp: ListSecretsResponse = await client.list(
            ListSecretsRequest.fromPartial({
                folderId,
                pageSize: 100,
                pageToken: pageToken || ''
            })
        )
        if (resp.secrets) {
            for (const secret of resp.secrets) {
                folderSecretsMap.set(secret.name, secret)
            }
        }
        pageToken = resp.nextPageToken
    } while (pageToken)

    return folderSecretsMap
}

/**
 * Resolves 'latest' versionId to actual version ID for Lockbox secrets.
 *
 * Uses a two-stage resolution approach:
 * 1. First attempts to resolve secrets by ID
 * 2. If ID lookup fails, lists all secrets in folder and matches by name
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param folderId - Yandex Cloud folder ID containing the secrets
 * @param secrets - Array of secrets that may contain 'latest' versionId
 * @returns Secrets with resolved version IDs
 * @throws {Error} If secret resolution fails or secret has no current version
 *
 * @see ADR 002 for rationale on 'latest' version resolution
 */
export async function resolveLatestLockboxVersions(
    session: Session,
    folderId: string,
    secrets: Secret[]
): Promise<Secret[]> {
    const secretsWithLatest = secrets.filter(s => s.versionId === 'latest')
    if (secretsWithLatest.length === 0) {
        return secrets
    }

    const results = await resolveSecretsById(session, secretsWithLatest)
    const fallbackIndices = results.map((r, i) => (r.status === 'fallback' ? i : -1)).filter(i => i !== -1)

    if (fallbackIndices.length > 0) {
        info(`Failed to resolve ${fallbackIndices.length} secrets by ID. Trying to find by name in folder ${folderId}`)

        const folderSecretsMap = await findSecretsInFolder(session, folderId)

        for (const index of fallbackIndices) {
            const result = results[index]
            if (result.status !== 'fallback') continue

            const originalSecret = result.original
            const match = folderSecretsMap.get(originalSecret.id)

            if (match) {
                info(`Resolved secret "${originalSecret.id}" to ID "${match.id}"`)
                if (!match.currentVersion) {
                    results[index] = {
                        status: 'error',
                        error: new Error(`Secret ${originalSecret.id} (found as ${match.id}) has no current version`)
                    }
                } else {
                    results[index] = {
                        status: 'success',
                        secret: {
                            ...originalSecret,
                            id: match.id,
                            versionId: match.currentVersion.id
                        }
                    }
                }
            }
        }
    }

    const resolutionErrors: Error[] = []
    const resolvedMap = new Map<Secret, Secret>()

    for (const [index, secret] of secretsWithLatest.entries()) {
        const result = results[index]
        if (result.status === 'success') {
            resolvedMap.set(secret, result.secret)
        } else if (result.status === 'error') {
            resolutionErrors.push(result.error)
        } else if (result.status === 'fallback') {
            resolutionErrors.push(new Error(`Failed to resolve secret: ${secret.id}`))
        }
    }

    if (resolutionErrors.length > 0) {
        const errorMessages = resolutionErrors.map(e => e.message).join(', ')
        throw new Error(`Failed to resolve latest versions for secrets: ${errorMessages}`)
    }

    return secrets.map(s => resolvedMap.get(s) || s)
}

/**
 * Creates new version of Yandex Cloud Function with provided configuration.
 *
 * Orchestrates version creation including:
 * - Service account resolution
 * - Lockbox secret version resolution
 * - Environment variables parsing
 * - Async invocation config creation
 * - Package upload (S3 or inline)
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param functionId - Target function ID
 * @param fileContents - Zip archive buffer containing function code
 * @param bucketObjectName - S3 object name (empty if inline upload)
 * @param inputs - Complete action inputs configuration
 * @returns Created function version ID
 * @throws {Error} If version creation fails or payload exceeds 3.5MB without bucket
 *
 * @remarks
 * Inline uploads are limited to 3670016 bytes (3.5 MB).
 * For larger payloads, provide bucket name for S3 upload.
 */
async function createFunctionVersion(
    session: Session,
    functionId: string,
    fileContents: Buffer,
    bucketObjectName: string,
    inputs: ActionInputs
): Promise<string> {
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
        secrets = await resolveLatestLockboxVersions(session, inputs.folderId, secrets)

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
        // Use S3 bucket upload for larger payloads
        if (inputs.bucket) {
            info(`From bucket: "${inputs.bucket}"`)
            // Include SHA256 hash for content verification
            const sha256 = createHash('sha256').update(fileContents).digest('hex')
            request.package = { bucketName: inputs.bucket, objectName: bucketObjectName, sha256 }
        } else {
            // Inline upload limited to 3.5 MB (3670016 bytes)
            // For larger payloads, caller should provide bucket name
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

/**
 * Main entry point for GitHub Action execution.
 *
 * Handles three authentication methods:
 * 1. Service Account JSON (`yc-sa-json-credentials`)
 * 2. IAM Token (`yc-iam-token`)
 * 3. Workload Identity Federation (`yc-sa-id` with GitHub OIDC token)
 *
 * Orchestrates full deployment flow:
 * - Parse and validate inputs
 * - Create zip archive
 * - Create/find function
 * - Upload to S3 (if bucket provided)
 * - Create function version
 * - Write GitHub Actions summary
 *
 * @throws {Error} Sets action as failed on any error
 */
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
        // Authentication method priority: SA JSON > IAM token > WIF
        if (ycSaJsonCredentials !== '') {
            const serviceAccountJson = parseServiceAccountJsonFile(ycSaJsonCredentials)
            info('Parsed Service account JSON')
            sessionConfig = { serviceAccountJson }
        } else if (ycIamToken !== '') {
            sessionConfig = { iamToken: ycIamToken }
            info('Using IAM token')
        } else if (ycSaId !== '') {
            // Workload Identity Federation: exchange GitHub OIDC token for Yandex IAM token
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
