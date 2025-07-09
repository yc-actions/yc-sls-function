import { Version as LockboxVersion } from '@yandex-cloud/nodejs-sdk/lockbox-v1/secret'
import { FunctionServiceMock } from './serverless-functions-v1'

jest.disableAutomock()

let lockboxVersions: LockboxVersion[] = []
export const LockboxSecretServiceMock = {
    listVersions: jest.fn().mockImplementation(() => ({ versions: lockboxVersions }))
}

export function __setLockboxVersions(value: LockboxVersion[]) {
    lockboxVersions = value
}

// noinspection JSUnusedGlobalSymbols
export const secretService = {
    SecretServiceClient: jest.fn(() => LockboxSecretServiceMock)
}
