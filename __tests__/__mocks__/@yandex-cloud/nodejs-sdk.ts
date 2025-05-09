import {
    Function,
    Function_Status,
    Version,
    Version_Status
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { Operation } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/operation/operation'
import { Writer } from 'protobufjs'
import { decodeMessage } from '@yandex-cloud/nodejs-sdk'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'
import {
    CreateFunctionMetadata,
    CreateFunctionVersionMetadata
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function_service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sdk: any = jest.createMockFromModule('@yandex-cloud/nodejs-sdk')

let functions: Function[] = []
let versions: Version[] = []
let serviceAccounts: ServiceAccount[] = [
    ServiceAccount.fromJSON({
        id: 'serviceaccountid'
    })
]
let createFunctionFail = false
let createVersionFail = false

type PayloadClass<T> = {
    $type: string
    encode: (message: T, writer?: Writer) => Writer
    decode: (payload: Uint8Array) => T
    fromJSON: (payload: object) => T
}

function getOperation<P, M>(
    payloadClass: PayloadClass<P>,
    data: object,
    metadataClass?: PayloadClass<M>,
    metadata?: object
): Operation {
    return Operation.fromJSON({
        id: 'operationid',
        response: {
            typeUrl: payloadClass.$type,
            value: Buffer.from(payloadClass.encode(payloadClass.fromJSON(data)).finish()).toString('base64')
        },
        metadata: metadataClass
            ? {
                  typeUrl: metadataClass?.$type,
                  value: Buffer.from(metadataClass?.encode(metadataClass?.fromJSON(metadata ?? {})).finish()).toString(
                      'base64'
                  )
              }
            : undefined,
        done: true
    })
}

const FunctionServiceMock = {
    create: jest.fn().mockImplementation(() => {
        if (createFunctionFail) {
            return Operation.fromJSON({
                id: 'operationid',
                error: {},
                done: true
            })
        }

        const data: Function = {
            $type: 'yandex.cloud.serverless.functions.v1.Function',
            id: 'functionid',
            /** ID of the folder that the function belongs to. */
            folderId: 'folderid',
            /** Creation timestamp for the function. */
            createdAt: new Date(),
            /** Name of the function. The name is unique within the folder. */
            name: 'functionname',
            /** Description of the function. */
            description: 'functiondescription',
            /** Function labels as `key:value` pairs. */
            labels: {},
            /** URL that needs to be requested to invoke the function. */
            httpInvokeUrl: 'https://functions.yandexcloud.net/fucntionid',
            /** Status of the function. */
            status: Function_Status.ACTIVE,
            logGroupId: ''
        }

        functions = [Function.fromJSON(data)]
        return getOperation(Function, data, CreateFunctionMetadata, { functionId: 'functionid' })
    }),
    get: jest.fn().mockImplementation(() => {
        return functions[0]
    }),
    list: jest.fn().mockImplementation(() => ({
        functions
    })),
    createVersion: jest.fn().mockImplementation(() => {
        if (createVersionFail) {
            return Operation.fromJSON({
                id: 'operationid',
                error: {},
                done: true
            })
        }

        const data: Version = {
            $type: 'yandex.cloud.serverless.functions.v1.Version',
            id: 'versionid',
            /** ID of the function that the version belongs to. */
            functionId: 'functionid',
            /** Creation timestamp for the version. */
            createdAt: new Date(),
            /** Description of the version. */
            description: 'versiondescription',
            /** Status of the version. */
            status: Version_Status.ACTIVE,
            runtime: 'python312',
            entrypoint: 'main.handler',
            serviceAccountId: 'serviceaccountid',
            imageSize: 0,
            tags: [],
            environment: {
                FOO: 'bar'
            },
            secrets: [],
            storageMounts: [],
            logGroupId: '',
            namedServiceAccounts: {}
        }

        versions = [Version.fromJSON(data)]
        return getOperation(Version, data, CreateFunctionVersionMetadata, { functionVersionId: 'versionid' })
    }),
    listVersions: jest.fn().mockImplementation(() => ({
        versions
    }))
}

const ServiceAccountServiceMock = {
    list: jest.fn().mockImplementation(() => ({
        serviceAccounts
    }))
}

sdk.Session = jest.fn().mockImplementation(() => ({
    client: (service: { serviceName: string }) => {
        if (service.serviceName === 'yandex.cloud.serverless.functions.v1.FunctionService') {
            return FunctionServiceMock
        }
        if (service.serviceName === 'yandex.cloud.iam.v1.ServiceAccountService') {
            return ServiceAccountServiceMock
        }
    }
}))

sdk.waitForOperation = jest.fn().mockImplementation((op: Operation) => op)
sdk.decodeMessage = decodeMessage

sdk.__setFunctionList = (value: Function[]) => {
    functions = value
}

sdk.__setVersionList = (value: Version[]) => {
    versions = value
}

sdk.__setServiceAccountList = (value: ServiceAccount[]) => {
    serviceAccounts = value
}

sdk.__setCreateFunctionFail = (value: boolean) => {
    createFunctionFail = value
}
sdk.__setCreateVersionFail = (value: boolean) => {
    createVersionFail = value
}
sdk.__getMocks = () => {
    return {
        FunctionServiceMock,
        ServiceAccountServiceMock
    }
}

export = sdk
