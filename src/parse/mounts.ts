/**
 * Parser for Object Storage mount point syntax.
 *
 * Converts short syntax to structured Mount objects for function configuration.
 *
 * @module
 */

import {
    Mount,
    Mount_Mode
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'

/**
 * Parses Object Storage mount specifications from short syntax.
 *
 * @param mounts - Array of mount specifications in short syntax (multiline input)
 * @returns Array of structured Mount objects
 * @throws {Error} If mount syntax is invalid
 *
 * @example
 * // Syntax: <mount-point>:<bucket>[/<prefix>][:ro]
 * parseMounts([
 *   'data:my-bucket',                    // Read-write mount to root
 *   'images:my-bucket/photos/:ro',       // Read-only mount to prefix
 *   'logs:my-bucket:ro',                 // Read-only mount to root
 *   'logs:my-bucket/logs',               // Read-write mount to prefix
 *   'logs:my-bucket/logs:ro'             // Read-only mount to prefix
 * ])
 */
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
