/**
 * Function version creation.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { debug, endGroup, error, info, setFailed, setOutput, startGroup } from '@actions/core'
import { Session, waitForOperation } from '@yandex-cloud/nodejs-sdk'
import { functionService } from '@yandex-cloud/nodejs-sdk/serverless-functions-v1'
import { CreateFunctionVersionRequest } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function_service'
import { CreateFunctionVersionMetadata } from '@yandex-cloud/nodejs-sdk/serverless-functions-v1/function_service'
import { ActionInputs } from '../action-inputs.js'
import { createAsyncInvocationConfig } from '../async-invocation.js'
import { resolveLatestLockboxVersions } from '../lockbox.js'
import { parseEnvironmentVariables, parseLockboxVariables, parseMounts } from '../parse/index.js'
import { resolveServiceAccountId } from '../service-account.js'

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
export async function createFunctionVersion(
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
