import { Version as LockboxVersion } from '@yandex-cloud/nodejs-sdk/lockbox-v1/secret'

jest.disableAutomock()

let lockboxVersions: LockboxVersion[] = []
export const LockboxSecretServiceMock = {
    get: jest.fn().mockImplementation(() => {
        // Find the latest version based on createdAt timestamp
        const sortedVersions = [...lockboxVersions].sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
        const currentVersion = sortedVersions[0]

        return {
            currentVersion: currentVersion || undefined
        }
    })
}

export function __setLockboxVersions(value: LockboxVersion[]) {
    lockboxVersions = value
}

// noinspection JSUnusedGlobalSymbols
export const secretService = {
    SecretServiceClient: jest.fn(() => LockboxSecretServiceMock)
}
