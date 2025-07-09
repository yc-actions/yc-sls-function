import { summary } from '@actions/core'

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
