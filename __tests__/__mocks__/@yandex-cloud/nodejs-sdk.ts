import { Operation } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/operation/operation'
import {
    __setCreateFunctionFail,
    __setCreateVersionFail,
    __setFunctionList,
    __setVersionList,
    FunctionServiceMock
} from './nodejs-sdk/serverless-functions-v1'
import { __setServiceAccountList, ServiceAccountServiceMock } from './nodejs-sdk/iam-v1'
import { __setLockboxVersions, LockboxSecretServiceMock } from './nodejs-sdk/lockbox-v1'
export { errors } from '@yandex-cloud/nodejs-sdk'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sdk: any = jest.createMockFromModule('@yandex-cloud/nodejs-sdk')

sdk.Session = jest.fn().mockImplementation(() => ({
    client: (service: jest.Constructable) => {
        return new service()
    }
}))

sdk.waitForOperation = jest.fn().mockImplementation((op: Operation) => op)

sdk.__setFunctionList = __setFunctionList
sdk.__setVersionList = __setVersionList
sdk.__setServiceAccountList = __setServiceAccountList
sdk.__setCreateFunctionFail = __setCreateFunctionFail
sdk.__setCreateVersionFail = __setCreateVersionFail
sdk.__setLockboxVersions = __setLockboxVersions
sdk.__getMocks = () => {
    return {
        FunctionServiceMock,
        ServiceAccountServiceMock,
        LockboxSecretServiceMock
    }
}

export = sdk
