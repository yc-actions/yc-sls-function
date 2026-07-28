/**
 * Lockbox secret version resolution.
 *
 * @module
 */

import { info } from '@actions/core'
import { Session } from '@yandex-cloud/nodejs-sdk'
import { secretService } from '@yandex-cloud/nodejs-sdk/lockbox-v1'
import {
    GetSecretRequest,
    ListSecretsRequest,
    ListSecretsResponse
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret_service'
import { Secret as LockboxSecret } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'
import { Secret } from './parse/index.js'

/** Parallel SecretService.Get calls. Keeps large secret lists from serialising. */
const GET_CONCURRENCY = 5

/** Page size for SecretService.List during name-based resolution. */
const LIST_PAGE_SIZE = 100

/**
 * Outcome of resolving one secret reference.
 *
 * `fallback` means the id was rejected by Lockbox and may in fact be a name,
 * so the reference is handed to the folder-wide name lookup.
 */
type ResolutionResult =
    | { status: 'success'; secret: Secret }
    | { status: 'fallback'; original: Secret }
    | { status: 'error'; error: Error }

/**
 * Maps over items with a bounded number of in-flight promises, preserving order.
 *
 * @param items - Items to map
 * @param limit - Maximum number of concurrent calls
 * @param fn - Async mapper
 * @returns Results in the same order as `items`
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length)
    let next = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++
            results[index] = await fn(items[index])
        }
    })
    await Promise.all(workers)
    return results
}

/**
 * Resolves secrets by treating their `id` as a Lockbox secret ID.
 *
 * A failed lookup is not an error: the value may be a secret name, which the
 * caller resolves in a second pass.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param secrets - Secrets to resolve
 * @returns One result per secret, in input order
 */
async function resolveSecretsById(session: Session, secrets: Secret[]): Promise<ResolutionResult[]> {
    const client = session.client(secretService.SecretServiceClient)
    return mapWithConcurrency(secrets, GET_CONCURRENCY, async (secret): Promise<ResolutionResult> => {
        let lockboxSecret: LockboxSecret
        try {
            lockboxSecret = await client.get(GetSecretRequest.fromPartial({ secretId: secret.id }))
        } catch {
            // Not a usable ID - defer to name-based resolution.
            return { status: 'fallback', original: secret }
        }
        if (!lockboxSecret.currentVersion) {
            return { status: 'error', error: new Error(`Secret ${secret.id} has no current version`) }
        }
        // Replace 'latest' with actual version ID for stable deployments
        return { status: 'success', secret: { ...secret, versionId: lockboxSecret.currentVersion.id } }
    })
}

/**
 * Lists every secret in a folder, keyed by name.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param folderId - Folder to list
 * @returns Map of secret name to secret metadata
 *
 * @remarks
 * Requires `lockbox.viewer`; `lockbox.payloadViewer` alone cannot list.
 */
async function findSecretsInFolder(session: Session, folderId: string): Promise<Map<string, LockboxSecret>> {
    const client = session.client(secretService.SecretServiceClient)
    const byName = new Map<string, LockboxSecret>()
    let pageToken = ''
    do {
        const resp: ListSecretsResponse = await client.list(
            ListSecretsRequest.fromPartial({ folderId, pageSize: LIST_PAGE_SIZE, pageToken })
        )
        for (const secret of resp.secrets ?? []) {
            byName.set(secret.name, secret)
        }
        pageToken = resp.nextPageToken
    } while (pageToken)
    return byName
}

/**
 * Resolves 'latest' versionId to actual version ID for Lockbox secrets.
 *
 * Resolution runs in two stages:
 * 1. Look the reference up as a secret ID (`lockbox.payloadViewer`).
 * 2. For references Lockbox rejected, list the folder once and match by name
 *    (`lockbox.viewer`), rewriting the reference to the real secret ID.
 *
 * Secrets pinned to an explicit version are returned untouched, as is the
 * order of the input array.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param folderId - Folder containing the secrets, used for name-based lookup
 * @param secrets - Array of secrets that may contain 'latest' versionId
 * @returns Secrets with resolved version IDs
 * @throws {Error} If any secret cannot be resolved or has no current version.
 *   All failures are reported together in a single message.
 *
 * @see ADR 002 for rationale on 'latest' version resolution
 * @see ADR 003 for rationale on name-based resolution
 */
export async function resolveLatestLockboxVersions(
    session: Session,
    folderId: string,
    secrets: Secret[]
): Promise<Secret[]> {
    const pending = secrets
        .map((secret, index) => ({ secret, index }))
        .filter(({ secret }) => secret.versionId === 'latest')
    if (pending.length === 0) {
        return secrets
    }

    const results = await resolveSecretsById(
        session,
        pending.map(({ secret }) => secret)
    )

    const fallbackCount = results.filter(result => result.status === 'fallback').length
    if (fallbackCount > 0) {
        info(`Failed to resolve ${fallbackCount} secret(s) by ID. Looking them up by name in folder ${folderId}`)
        const byName = await findSecretsInFolder(session, folderId)
        for (const [i, result] of results.entries()) {
            if (result.status !== 'fallback') {
                continue
            }
            const match = byName.get(result.original.id)
            if (!match) {
                // Neither an ID nor a name in this folder - reported below.
                continue
            }
            info(`Resolved secret "${result.original.id}" to ID "${match.id}"`)
            results[i] = match.currentVersion
                ? {
                      status: 'success',
                      secret: { ...result.original, id: match.id, versionId: match.currentVersion.id }
                  }
                : {
                      status: 'error',
                      error: new Error(`Secret ${result.original.id} (found as ${match.id}) has no current version`)
                  }
        }
    }

    const resolved = [...secrets]
    const failures: Error[] = []
    for (const [i, { secret, index }] of pending.entries()) {
        const result = results[i]
        if (result.status === 'success') {
            resolved[index] = result.secret
        } else if (result.status === 'error') {
            failures.push(result.error)
        } else {
            failures.push(new Error(`Failed to resolve secret: ${secret.id}`))
        }
    }

    if (failures.length > 0) {
        throw new Error(`Failed to resolve latest versions for secrets: ${failures.map(e => e.message).join(', ')}`)
    }

    return resolved
}
