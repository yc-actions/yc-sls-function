import { jest } from '@jest/globals'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'

let serviceAccounts: ServiceAccount[] = [ServiceAccount.fromJSON({ id: 'serviceaccountid' })]

export const ServiceAccountServiceMock = {
    list: jest.fn(() => ({ serviceAccounts }))
}

export function __setServiceAccountList(value: ServiceAccount[]): void {
    serviceAccounts = value
}

export const serviceAccountService = {
    ServiceAccountServiceClient: jest.fn(() => ServiceAccountServiceMock)
}
