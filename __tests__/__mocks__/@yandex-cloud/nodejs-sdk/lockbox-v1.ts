import { Version as LockboxVersion } from '@yandex-cloud/nodejs-sdk/lockbox-v1/secret'
import { Secret } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'

jest.disableAutomock()

let lockboxVersions: LockboxVersion[] = []
let secrets: Secret[] = []
let getSecretFail = false

export const LockboxSecretServiceMock = {
    get: jest.fn().mockImplementation((req: { secretId: string }) => {
        if (getSecretFail) {
            return Promise.reject(new Error(`Secret not found: ${req.secretId}`))
        }
        // Find the latest version based on createdAt timestamp
        const sortedVersions = [...lockboxVersions].sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
        const currentVersion = sortedVersions[0]

        return {
            currentVersion: currentVersion || undefined
        }
    }),
    list: jest.fn().mockImplementation(async (): Promise<{ secrets: Secret[]; nextPageToken: string }> => {
        // Since we don't support filter in parameters anymore passing all is enough for tests as we filter in main.ts
        // But for test "should resolve ... by secret name" we need to return the secrets that include the one with the name
        // In the test setup __setSecretList sets the secrets
        return { secrets, nextPageToken: '' }
    })
}

export function __setLockboxVersions(value: LockboxVersion[]) {
    lockboxVersions = value
}

export function __setSecretList(value: Secret[]) {
    secrets = value
}

export function __setGetSecretFail(value: boolean) {
    getSecretFail = value
}

// noinspection JSUnusedGlobalSymbols
export const secretService = {
    SecretServiceClient: jest.fn(() => LockboxSecretServiceMock)
}
