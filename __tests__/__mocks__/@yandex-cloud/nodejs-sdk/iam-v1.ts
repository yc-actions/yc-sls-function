import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'

jest.disableAutomock()

let serviceAccounts: ServiceAccount[] = [
    ServiceAccount.fromJSON({
        id: 'serviceaccountid'
    })
]
export const ServiceAccountServiceMock = {
    list: jest.fn().mockImplementation(() => ({
        serviceAccounts
    }))
}

export function __setServiceAccountList(value: ServiceAccount[]) {
    serviceAccounts = value
}

// noinspection JSUnusedGlobalSymbols
export const serviceAccountService = {
    ServiceAccountServiceClient: jest.fn(() => ServiceAccountServiceMock)
}
