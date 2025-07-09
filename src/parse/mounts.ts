import {
    Mount,
    Mount_Mode
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'

// Parse mounts from short syntax lines to structured objects
// Syntax: <mount-point>:<bucket>[/<prefix>][:ro]
export function parseMounts(mounts: string[]): Mount[] {
    return mounts
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            // Regex to match: <mount-point>:<bucket>[/<prefix>][:ro]
            // Examples:
            //   data:my-bucket
            //   images:my-bucket/photos/:ro
            //   logs:my-bucket:ro
            //   logs:my-bucket/logs
            //   logs:my-bucket/logs:ro
            const match = line.match(/^([^:]+):([^:/]+)(?:\/([^:]*))?(?::(ro))?$/)
            if (!match) {
                throw new Error(`Invalid mount syntax: '${line}'. Expected <mount-point>:<bucket>[/<prefix>][:ro]`)
            }
            const [, mountPoint, bucket, prefix, ro] = match
            return Mount.fromPartial({
                name: mountPoint,
                mode: ro === 'ro' ? Mount_Mode.READ_ONLY : Mount_Mode.READ_WRITE,
                objectStorage: {
                    bucketId: bucket,
                    prefix: typeof prefix === 'string' ? prefix : undefined
                }
            })
        })
}
