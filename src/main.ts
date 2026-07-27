/**
 * Main entry point for Yandex Cloud Serverless Function deployment.
 *
 * Handles authentication (SA JSON, IAM token, WIF) and orchestrates the deploy:
 * zip, find-or-create function, optional S3 upload, create version, summary.
 *
 * @see {@link https://github.com/yc-actions/yc-sls-function} for usage examples
 * @module
 */

import { error, getIDToken, getInput, info, setCommandEcho, setFailed, setOutput } from '@actions/core'
import { errors, Session } from '@yandex-cloud/nodejs-sdk'
import { SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'
import archiver from 'archiver'

import { ActionInputs, readInputs } from './action-inputs.js'
import { exchangeToken } from './auth.js'
import { getOrCreateFunctionId } from './function/create.js'
import { createFunctionVersion } from './function/version.js'
import { parseServiceAccountJsonFile } from './parse/index.js'
import { writeSummary } from './summary.js'
import { uploadToS3 } from './upload.js'
import { zipSources } from './zip.js'

/**
 * Resolves credentials from the action inputs.
 *
 * Priority: Service Account JSON, then IAM token, then Workload Identity
 * Federation via the GitHub OIDC token.
 *
 * @returns Session configuration for the Yandex Cloud SDK
 * @throws {Error} If no credentials are provided
 */
async function resolveSessionConfig(): Promise<SessionConfig> {
    const ycSaJsonCredentials = getInput('yc-sa-json-credentials')
    const ycIamToken = getInput('yc-iam-token')
    const ycSaId = getInput('yc-sa-id')

    if (ycSaJsonCredentials !== '') {
        const serviceAccountJson = parseServiceAccountJsonFile(ycSaJsonCredentials)
        info('Parsed Service account JSON')
        return { serviceAccountJson }
    }
    if (ycIamToken !== '') {
        info('Using IAM token')
        return { iamToken: ycIamToken }
    }
    if (ycSaId !== '') {
        // Workload Identity Federation: exchange GitHub OIDC token for Yandex IAM token
        const ghToken = await getIDToken()
        if (!ghToken) {
            throw new Error('No credentials provided')
        }
        const saToken = await exchangeToken(ghToken, ycSaId)
        return { iamToken: saToken }
    }
    throw new Error('No credentials')
}

/**
 * Main entry point for GitHub Action execution.
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
        const sessionConfig = await resolveSessionConfig()
        const session = new Session(sessionConfig)
        inputs = readInputs()
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
