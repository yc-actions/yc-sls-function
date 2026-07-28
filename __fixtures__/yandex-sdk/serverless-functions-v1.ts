import { jest } from '@jest/globals'
import {
    Function,
    Function_Status,
    Version,
    Version_Status
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { Operation } from '@yandex-cloud/nodejs-sdk/operation/operation'
import {
    CreateFunctionMetadata,
    CreateFunctionVersionMetadata
} from '@yandex-cloud/nodejs-sdk/serverless-functions-v1/function_service'

import { getOperation } from '../get-operation.js'

let functions: Function[] = []
let versions: Version[] = []
let createFunctionFail = false
let createVersionFail = false

export const FunctionServiceMock = {
    create: jest.fn(() => {
        if (createFunctionFail) {
            return Operation.fromJSON({ id: 'operationid', error: {}, done: true })
        }

        const data: Function = {
            id: 'functionid',
            folderId: 'folderid',
            createdAt: new Date(0),
            name: 'functionname',
            description: 'functiondescription',
            labels: {},
            httpInvokeUrl: 'https://functions.yandexcloud.net/fucntionid',
            status: Function_Status.ACTIVE
        }

        functions = [Function.fromJSON(data)]
        return getOperation(Function, data, CreateFunctionMetadata, { functionId: 'functionid' })
    }),
    get: jest.fn(() => functions[0]),
    list: jest.fn(() => ({ functions })),
    createVersion: jest.fn(() => {
        if (createVersionFail) {
            return Operation.fromJSON({ id: 'operationid', error: {}, done: true })
        }

        const data: Version = {
            id: 'versionid',
            functionId: 'functionid',
            createdAt: new Date(0),
            description: 'versiondescription',
            status: Version_Status.ACTIVE,
            runtime: 'python312',
            entrypoint: 'main.handler',
            serviceAccountId: 'serviceaccountid',
            imageSize: 0,
            tags: [],
            environment: { FOO: 'bar' },
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
    listVersions: jest.fn(() => ({ versions }))
}

export function __setCreateFunctionFail(value: boolean): void {
    createFunctionFail = value
}

export function __setCreateVersionFail(value: boolean): void {
    createVersionFail = value
}

export function __setFunctionList(value: Function[]): void {
    functions = value
}

export function __setVersionList(value: Version[]): void {
    versions = value
}

export const functionService = {
    FunctionServiceClient: jest.fn(() => FunctionServiceMock)
}
