/**
 * Lockbox secret version resolution.
 *
 * @module
 */

import { Session } from '@yandex-cloud/nodejs-sdk'
import { secretService } from '@yandex-cloud/nodejs-sdk/lockbox-v1'
import { GetSecretRequest } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret_service'
import { Secret } from './parse/index.js'

/**
 * Resolves 'latest' versionId to actual version ID for Lockbox secrets.
 *
 * Fetches current version from Lockbox API when versionId is 'latest'.
 * Otherwise returns secret unchanged.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param secrets - Array of secrets that may contain 'latest' versionId
 * @returns Secrets with resolved version IDs
 * @throws {Error} If secret has no current version
 *
 * @see ADR 002 for rationale on 'latest' version resolution
 */
export async function resolveLatestLockboxVersions(session: Session, secrets: Secret[]): Promise<Secret[]> {
    const lockboxClient = session.client(secretService.SecretServiceClient)
    const resolved: Secret[] = []
    for (const secret of secrets) {
        if (secret.versionId !== 'latest') {
            resolved.push(secret)
            continue
        }
        // Fetch secret metadata to get current version ID
        const resp = await lockboxClient.get(GetSecretRequest.fromPartial({ secretId: secret.id }))
        if (!resp.currentVersion) {
            throw new Error(`No current version found for Lockbox secret: ${secret.id}`)
        }
        // Replace 'latest' with actual version ID for stable deployments
        resolved.push({ ...secret, versionId: resp.currentVersion.id })
    }
    return resolved
}
