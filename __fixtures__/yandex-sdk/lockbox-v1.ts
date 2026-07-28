import { jest } from '@jest/globals'
import { Secret as LockboxSecret, Version as LockboxVersion } from '@yandex-cloud/nodejs-sdk/lockbox-v1/secret'

let lockboxVersions: LockboxVersion[] = []
let folderSecrets: LockboxSecret[] = []
let getSecretFails = false
let unknownSecretIds = new Set<string>()
let listPageSize = 0
let listFailure = ''

export const LockboxSecretServiceMock = {
    get: jest.fn(({ secretId }: { secretId: string }) => {
        // Lockbox denies Get when the caller passes a name instead of an ID.
        if (getSecretFails || unknownSecretIds.has(secretId)) {
            throw new Error('Secret not found')
        }
        // Newest createdAt wins - mirrors what Lockbox reports as currentVersion.
        const sorted = [...lockboxVersions].sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
        return { currentVersion: sorted[0] || undefined }
    }),
    list: jest.fn(({ pageToken }: { pageToken: string }) => {
        // Lockbox denies List without lockbox.viewer on the folder.
        if (listFailure) {
            throw new Error(listFailure)
        }
        // Page tokens are plain offsets - enough to exercise the pagination loop.
        const offset = pageToken ? Number(pageToken) : 0
        const size = listPageSize || folderSecrets.length
        const secrets = folderSecrets.slice(offset, offset + size)
        const nextOffset = offset + secrets.length
        return {
            secrets,
            nextPageToken: nextOffset < folderSecrets.length ? String(nextOffset) : ''
        }
    })
}

export function __setLockboxVersions(value: LockboxVersion[]): void {
    lockboxVersions = value
}

/** Secrets returned by SecretService.List, used for name-based resolution. */
export function __setSecretList(value: LockboxSecret[]): void {
    folderSecrets = value
}

/** Makes every SecretService.Get throw, simulating ids that are really names. */
export function __setGetSecretFail(value: boolean): void {
    getSecretFails = value
}

/** Makes SecretService.Get throw only for these ids, leaving the rest resolvable. */
export function __setUnknownSecretIds(value: string[]): void {
    unknownSecretIds = new Set(value)
}

/** Caps List page size so tests can cover the nextPageToken loop. 0 means one page. */
export function __setListPageSize(value: number): void {
    listPageSize = value
}

/** Makes SecretService.List throw with this message. Empty string means it succeeds. */
export function __setListFailure(message: string): void {
    listFailure = message
}

export const secretService = {
    SecretServiceClient: jest.fn(() => LockboxSecretServiceMock)
}
