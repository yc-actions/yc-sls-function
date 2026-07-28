/**
 * Function code upload to Yandex Object Storage.
 *
 * @module
 */

import { info, setFailed } from '@actions/core'
import { SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'
import { StorageServiceImpl } from './storage/index.js'
import { StorageObject } from './storage/storage-object.js'

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
export async function uploadToS3(
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
