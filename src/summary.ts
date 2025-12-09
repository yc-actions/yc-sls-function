/**
 * GitHub Actions job summary writer.
 *
 * Creates markdown summary with deployment results and console links.
 *
 * @module
 */

import { summary } from '@actions/core'

interface SummaryParams {
    functionName?: string
    functionId?: string
    versionId?: string
    bucket?: string
    bucketObjectName?: string
    errorMessage?: string
    folderId?: string
}

/**
 * Writes deployment summary to GitHub Actions job summary.
 *
 * Includes:
 * - Function name and ID (with console link)
 * - Version ID
 * - Bucket information (if used)
 * - Success/error status
 *
 * @param params - Summary parameters (all optional)
 * @param params.functionName - Function name
 * @param params.functionId - Function ID
 * @param params.versionId - Created version ID
 * @param params.bucket - S3 bucket name
 * @param params.bucketObjectName - S3 object key
 * @param params.errorMessage - Error message if deployment failed
 * @param params.folderId - Folder ID (used to construct console URL)
 *
 * @example
 * await writeSummary({
 *   functionName: 'my-function',
 *   functionId: 'd4e123abc',
 *   versionId: 'd4e456def',
 *   folderId: 'b1g789ghi'
 * })
 * // Creates summary with link: https://console.yandex.cloud/folders/{folderId}/functions/functions/{functionId}/overview
 */
export async function writeSummary({
    functionName,
    functionId,
    versionId,
    bucket,
    bucketObjectName,
    errorMessage,
    folderId
}: SummaryParams) {
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
