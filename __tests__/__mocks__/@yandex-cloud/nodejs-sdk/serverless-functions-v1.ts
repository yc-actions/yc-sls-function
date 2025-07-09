import {
    Function,
    Function_Status,
    Version,
    Version_Status
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { Operation } from '@yandex-cloud/nodejs-sdk/operation/operation'

import { getOperation } from '../get-operation'
import {
    CreateFunctionMetadata,
    CreateFunctionVersionMetadata
} from '@yandex-cloud/nodejs-sdk/serverless-functions-v1/function_service'

jest.disableAutomock()

let functions: Function[] = []
let versions: Version[] = []
let createFunctionFail = false
let createVersionFail = false
export const FunctionServiceMock = {
    create: jest.fn().mockImplementation(() => {
        if (createFunctionFail) {
            return Operation.fromJSON({
                id: 'operationid',
                error: {},
                done: true
            })
        }

        const data: Function = {
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
            status: Function_Status.ACTIVE
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
            namedServiceAccounts: {},
            tmpfsSize: 0,
            concurrency: 0,
            mounts: []
        }

        versions = [Version.fromJSON(data)]
        return getOperation(Version, data, CreateFunctionVersionMetadata, { functionVersionId: 'versionid' })
    }),
    listVersions: jest.fn().mockImplementation(() => ({
        versions
    }))
}

export function __setCreateFunctionFail(value: boolean) {
    createFunctionFail = value
}

export function __setCreateVersionFail(value: boolean) {
    createVersionFail = value
}

export function __setFunctionList(value: Function[]) {
    functions = value
}

export function __setVersionList(value: Version[]) {
    versions = value
}

// noinspection JSUnusedGlobalSymbols
export const functionService = {
    FunctionServiceClient: jest.fn(() => FunctionServiceMock)
}
