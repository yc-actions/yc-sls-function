import { jest } from '@jest/globals'
import { Version as LockboxVersion } from '@yandex-cloud/nodejs-sdk/lockbox-v1/secret'

let lockboxVersions: LockboxVersion[] = []

export const LockboxSecretServiceMock = {
    get: jest.fn(() => {
        // Newest createdAt wins - mirrors what Lockbox reports as currentVersion.
        const sorted = [...lockboxVersions].sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
        return { currentVersion: sorted[0] || undefined }
    })
}

export function __setLockboxVersions(value: LockboxVersion[]): void {
    lockboxVersions = value
}

export const secretService = {
    SecretServiceClient: jest.fn(() => LockboxSecretServiceMock)
}
