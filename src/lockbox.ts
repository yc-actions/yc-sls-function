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
 * Outcome of looking one reference up as a Lockbox secret ID.
 *
 * `unknown` means Lockbox rejected the ID, so the reference is handed to the
 * folder-wide name lookup. It carries the rejection reason: a transient failure
 * is indistinguishable from a name here, and must not be reported as one.
 */
type IdLookup = { status: 'found'; versionId: string } | { status: 'no-version' } | { status: 'unknown'; cause: string }

/** All references to one secret, sharing a single lookup. */
interface ReferenceGroup {
    reference: string
    entries: { secret: Secret; index: number }[]
}

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
 * Groups references so each distinct secret is looked up once.
 *
 * Several environment variables commonly read different keys of the same
 * secret; they share one API call and one outcome.
 *
 * @param pending - References awaiting resolution, with their input positions
 * @returns One group per distinct reference, in first-seen order
 */
function groupByReference(pending: { secret: Secret; index: number }[]): ReferenceGroup[] {
    const groups: ReferenceGroup[] = []
    const position = new Map<string, number>()
    for (const entry of pending) {
        const existing = position.get(entry.secret.id)
        if (existing === undefined) {
            position.set(entry.secret.id, groups.length)
            groups.push({ reference: entry.secret.id, entries: [entry] })
        } else {
            groups[existing].entries.push(entry)
        }
    }
    return groups
}

/**
 * Looks references up as Lockbox secret IDs.
 *
 * A rejected lookup is not an error: the value may be a secret name, which the
 * caller resolves in a second pass.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param references - Distinct secret IDs to look up
 * @returns One outcome per reference, in input order
 */
async function lookupSecretsById(session: Session, references: string[]): Promise<IdLookup[]> {
    const client = session.client(secretService.SecretServiceClient)
    return mapWithConcurrency(references, GET_CONCURRENCY, async (reference): Promise<IdLookup> => {
        let lockboxSecret: LockboxSecret
        try {
            lockboxSecret = await client.get(GetSecretRequest.fromPartial({ secretId: reference }))
        } catch (err) {
            // Not a usable ID - defer to name-based resolution, keeping the reason
            // so a transient failure is not reported as an unknown secret.
            return { status: 'unknown', cause: (err as Error).message }
        }
        if (!lockboxSecret.currentVersion) {
            return { status: 'no-version' }
        }
        return { status: 'found', versionId: lockboxSecret.currentVersion.id }
    })
}

/**
 * Finds secrets in a folder by name, stopping as soon as all are found.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param folderId - Folder to list
 * @param wanted - Names to look for
 * @returns Map of secret name to secret metadata, for the names that matched
 * @throws {Error} If the folder cannot be listed
 *
 * @remarks
 * Requires `lockbox.viewer` on the folder for the credentials the action
 * authenticates with, which reading a secret by ID does not.
 */
async function findSecretsByName(
    session: Session,
    folderId: string,
    wanted: Set<string>
): Promise<Map<string, LockboxSecret>> {
    const client = session.client(secretService.SecretServiceClient)
    const byName = new Map<string, LockboxSecret>()
    let pageToken = ''
    do {
        const resp: ListSecretsResponse = await client.list(
            ListSecretsRequest.fromPartial({ folderId, pageSize: LIST_PAGE_SIZE, pageToken })
        )
        for (const secret of resp.secrets) {
            if (wanted.has(secret.name)) {
                byName.set(secret.name, secret)
            }
        }
        // Every name accounted for - no reason to page through the rest of the folder.
        if (byName.size === wanted.size) {
            break
        }
        pageToken = resp.nextPageToken
    } while (pageToken)
    return byName
}

/**
 * Decides the final secret ID and version for one reference.
 *
 * @param reference - The `<secret-id>` value as written in the input
 * @param lookup - Outcome of looking the reference up as an ID
 * @param match - Folder secret whose name equals the reference, if any
 * @param folderId - Folder the name lookup searched, named in the failure
 * @returns The IDs to deploy with, or why the reference could not be resolved
 */
function resolveReference(
    reference: string,
    lookup: IdLookup,
    match: LockboxSecret | undefined,
    folderId: string
): { id: string; versionId: string } | { failure: string } {
    if (lookup.status === 'found') {
        return { id: reference, versionId: lookup.versionId }
    }
    if (lookup.status === 'no-version') {
        return { failure: `Secret ${reference} has no current version` }
    }
    if (!match) {
        return {
            failure:
                `secret "${reference}" is not a known id (${lookup.cause}) ` +
                `and no secret with that name exists in folder ${folderId}`
        }
    }
    if (!match.currentVersion) {
        return { failure: `Secret ${reference} (found as ${match.id}) has no current version` }
    }
    return { id: match.id, versionId: match.currentVersion.id }
}

/**
 * Resolves 'latest' versionId to actual version ID for Lockbox secrets.
 *
 * Resolution runs in two stages, one lookup per distinct reference:
 * 1. Look the reference up as a secret ID.
 * 2. For references Lockbox rejected, list the folder and match by name
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

    const groups = groupByReference(pending)
    const lookups = await lookupSecretsById(
        session,
        groups.map(group => group.reference)
    )

    const unknown = new Set(groups.filter((_, i) => lookups[i].status === 'unknown').map(group => group.reference))
    let byName = new Map<string, LockboxSecret>()
    if (unknown.size > 0) {
        info(`Failed to resolve ${unknown.size} secret(s) by ID. Looking them up by name in folder ${folderId}`)
        try {
            byName = await findSecretsByName(session, folderId, unknown)
        } catch (err) {
            throw new Error(
                `Failed to list secrets in folder ${folderId} while resolving ${unknown.size} secret(s) by name: ` +
                    `${(err as Error).message}. Grant lockbox.viewer on the folder to the credentials the action ` +
                    `authenticates with, or reference the secrets by id.`,
                { cause: err }
            )
        }
        for (const [name, match] of byName) {
            info(`Resolved secret "${name}" to ID "${match.id}"`)
        }
    }

    const resolved = [...secrets]
    // Deduplicated: one message per secret, however many keys reference it.
    const failures = new Set<string>()
    for (const [i, group] of groups.entries()) {
        const outcome = resolveReference(group.reference, lookups[i], byName.get(group.reference), folderId)
        if ('failure' in outcome) {
            failures.add(outcome.failure)
            continue
        }
        // Replace 'latest' with actual version ID for stable deployments
        for (const { secret, index } of group.entries) {
            resolved[index] = { ...secret, ...outcome }
        }
    }

    if (failures.size > 0) {
        throw new Error(`Failed to resolve latest versions for secrets: ${[...failures].join('; ')}`)
    }

    return resolved
}
