import * as core from '@actions/core'
import {
    __getMocks,
    __setCreateFunctionFail,
    __setCreateVersionFail,
    __setFunctionList,
    __setServiceAccountList,
    __setVersionList
} from '@yandex-cloud/nodejs-sdk'
import * as main from '../src/main'

import { context } from '@actions/github'
import axios from 'axios'
import { Instance } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/compute/v1/instance'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'
import fs from 'fs'
import os from 'os'
import path from 'path'

declare module '@yandex-cloud/nodejs-sdk' {
    function __setFunctionList(value: Instance[]): void

    function __setVersionList(value: Instance[]): void

    function __setServiceAccountList(value: ServiceAccount[]): void

    function __setCreateFunctionFail(value: boolean): void

    function __setCreateVersionFail(value: boolean): void

    function __getMocks(): any
}

jest.mock('../src/storage')

// Mock the action's main function
const runMock = jest.spyOn(main, 'run')

// Mock the GitHub Actions core library
let errorMock: jest.SpyInstance
let getInputMock: jest.SpyInstance
let getBooleanInputMock: jest.SpyInstance
let setFailedMock: jest.SpyInstance
let setOutputMock: jest.SpyInstance
let getIdTokenMock: jest.SpyInstance
let axiosPostMock: jest.SpyInstance

// yandex sdk mock

const requiredInputs: Record<string, string> = {
    'folder-id': 'folderid',
    'function-name': 'my-function',
    runtime: 'nodejs16',
    entrypoint: 'index.handler',
    'logs-disabled': 'false',
    async: 'false'
}

const defaultValues: Record<string, string> = {
    ...requiredInputs,
    bucket: 'some-bucket',
    sourceRoot: '.',
    memory: '128Mb',
    environment: 'FOO=BAR\nFOO2=BAR2',
    'execution-timeout': '5',
    'service-account': 'serviceaccountid',
    'service-account-name': '',
    secrets: '',
    'network-id': '',
    tags: '',
    'logs-disabled': 'false',
    'logs-group-id': '',
    'log-level': '',
    async: 'false',
    'async-sa-id': '',
    'async-sa-name': '',
    'async-retries-count': '',
    'async-success-ymq-arn': '',
    'async-success-sa-id': '',
    'async-success-sa-name': '',
    'async-failure-ymq-arn': '',
    'async-failure-sa-id': '',
    'async-failure-sa-name': ''
}

const asyncInputs: Record<string, string> = {
    ...defaultValues,
    async: 'true',
    'async-sa-id': 'async-sa-id',
    'async-sa-name': '',
    'async-retries-count': '3',
    'async-success-ymq-arn': 'arn:aws:sqs:us-east-1:123456789012:queue-name',
    'async-success-sa-id': 'success-sa-id',
    'async-success-sa-name': '',
    'async-failure-ymq-arn': 'arn:aws:sqs:us-east-1:123456789012:queue-name',
    'async-failure-sa-id': 'failure-sa-id',
    'async-failure-sa-name': ''
}

const ycSaJsonCredentials: Record<string, string> = {
    'yc-sa-json-credentials': `{
    "id": "id",
    "created_at": "2021-01-01T00:00:00Z", 
    "key_algorithm": "RSA_2048",
    "service_account_id": "service_account_id",
    "private_key": "private_key",
    "public_key": "public_key"
  }`
}

describe('action', () => {
    let tmpSummaryFile: string
    beforeEach(() => {
        // Set GITHUB_STEP_SUMMARY to a temp file
        tmpSummaryFile = path.join(os.tmpdir(), `gh-summary-${Date.now()}`)
        process.env.GITHUB_STEP_SUMMARY = tmpSummaryFile
        fs.writeFileSync(tmpSummaryFile, '', { flag: 'w' }) // Ensure file exists and is writable
        jest.clearAllMocks()

        errorMock = jest.spyOn(core, 'error').mockImplementation()
        getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
        getBooleanInputMock = jest.spyOn(core, 'getBooleanInput').mockImplementation()
        setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
        setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation()
        getIdTokenMock = jest.spyOn(core, 'getIDToken').mockImplementation(async () => {
            return 'github-token'
        })
        axiosPostMock = jest.spyOn(axios, 'post').mockImplementation(async () => {
            return {
                status: 200,
                data: {
                    access_token: 'iam-token'
                }
            }
        })
        jest.spyOn(context, 'repo', 'get').mockImplementation(() => {
            return {
                owner: 'some-owner',
                repo: 'some-repo'
            }
        })
        __setServiceAccountList([
            ServiceAccount.fromJSON({
                id: 'serviceaccountid'
            })
        ])
        __setCreateFunctionFail(false)
        __setCreateVersionFail(false)
        process.env['GITHUB_REPOSITORY'] = 'owner/repo'
        process.env['GITHUB_SHA'] = 'sha'
    })
    afterEach(() => {
        jest.clearAllMocks()
        __setFunctionList([])
        __setVersionList([])
        if (tmpSummaryFile && fs.existsSync(tmpSummaryFile)) {
            fs.unlinkSync(tmpSummaryFile)
        }
        delete process.env.GITHUB_STEP_SUMMARY
    })

    it('should run with required inputs', async () => {
        setupMockInputs({ ...requiredInputs, ...ycSaJsonCredentials })

        await main.run()

        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
    })

    it('should run with all inputs', async () => {
        setupMockInputs({ ...defaultValues, ...ycSaJsonCredentials })

        await main.run()

        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
    })

    it('should run with async inputs', async () => {
        setupMockInputs({ ...asyncInputs, ...ycSaJsonCredentials })

        await main.run()

        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
        const mocks = __getMocks().FunctionServiceMock
        expect(mocks.createVersion).toHaveBeenCalledWith(
            expect.objectContaining({
                asyncInvocationConfig: expect.objectContaining({
                    serviceAccountId: 'async-sa-id',
                    failureTarget: expect.objectContaining({
                        ymqTarget: expect.objectContaining({
                            queueArn: 'arn:aws:sqs:us-east-1:123456789012:queue-name',
                            serviceAccountId: 'failure-sa-id'
                        })
                    }),
                    successTarget: expect.objectContaining({
                        ymqTarget: expect.objectContaining({
                            queueArn: 'arn:aws:sqs:us-east-1:123456789012:queue-name',
                            serviceAccountId: 'success-sa-id'
                        })
                    }),
                    retriesCount: 3
                })
            })
        )
    })

    it('should create async function with async input only', async () => {
        setupMockInputs({
            ...requiredInputs,
            ...ycSaJsonCredentials,
            async: 'true',
            'service-account': 'serviceaccountid'
        })
        __setServiceAccountList([
            ServiceAccount.fromJSON({
                id: 'serviceaccountid'
            })
        ])

        await main.run()
        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setFailedMock).not.toHaveBeenCalled()

        const mocks = __getMocks().FunctionServiceMock
        expect(mocks.createVersion).toHaveBeenCalledWith(
            expect.objectContaining({
                asyncInvocationConfig: expect.objectContaining({
                    serviceAccountId: 'serviceaccountid',
                    failureTarget: expect.objectContaining({
                        emptyTarget: expect.objectContaining({})
                    }),
                    successTarget: expect.objectContaining({
                        emptyTarget: expect.objectContaining({})
                    }),
                    retriesCount: 3
                })
            })
        )
    })

    it('should skip function creation if it already exists', async () => {
        setupMockInputs({ ...defaultValues, ...ycSaJsonCredentials })
        __setFunctionList([
            Instance.fromJSON({
                id: 'functionid',
                name: 'my-function',
                folder_id: 'folderid',
                status: 'ACTIVE'
            })
        ])

        await main.run()

        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(__getMocks().FunctionServiceMock.create).not.toHaveBeenCalled()
    })

    it('should resolve service account id from name', async () => {
        setupMockInputs({ ...requiredInputs, ...ycSaJsonCredentials, 'service-account-name': 'service-account-name' })
        __setServiceAccountList([
            ServiceAccount.fromJSON({
                id: 'serviceaccountid',
                name: 'service-account-name'
            })
        ])

        await main.run()

        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(__getMocks().FunctionServiceMock.createVersion).toHaveBeenCalledWith(
            expect.objectContaining({
                serviceAccountId: 'serviceaccountid'
            })
        )
        expect(__getMocks().ServiceAccountServiceMock.list).toHaveBeenCalledWith(
            expect.objectContaining({
                folderId: 'folderid',
                filter: 'name = "service-account-name"'
            })
        )
    })
})

describe('writeSummary', () => {
    let addHeadingMock: jest.Mock
    let addListMock: jest.Mock
    let writeMock: jest.Mock
    let tmpSummaryFile: string
    beforeEach(() => {
        // Set GITHUB_STEP_SUMMARY to a temp file
        tmpSummaryFile = path.join(os.tmpdir(), `gh-summary-${Date.now()}`)
        process.env.GITHUB_STEP_SUMMARY = tmpSummaryFile
        fs.writeFileSync(tmpSummaryFile, '', { flag: 'w' }) // Ensure file exists and is writable
        addHeadingMock = jest.fn().mockReturnThis()
        addListMock = jest.fn().mockReturnThis()
        writeMock = jest.fn().mockResolvedValue(undefined)
        jest.spyOn(core, 'summary', 'get').mockReturnValue({
            addHeading: addHeadingMock,
            addList: addListMock,
            write: writeMock
        } as any)
    })
    afterEach(() => {
        jest.restoreAllMocks()
        if (tmpSummaryFile && fs.existsSync(tmpSummaryFile)) {
            fs.unlinkSync(tmpSummaryFile)
        }
        delete process.env.GITHUB_STEP_SUMMARY
    })
    it('writes all fields with function id as markdown link', async () => {
        await main.writeSummary({
            functionName: 'fn',
            functionId: 'id',
            versionId: 'vid',
            bucket: 'b',
            bucketObjectName: 'obj',
            errorMessage: undefined,
            folderId: 'folderid'
        })
        expect(addHeadingMock).toHaveBeenCalledWith('Yandex Cloud Function Deployment Summary', 2)
        expect(addListMock).toHaveBeenCalledWith([
            'Function Name: fn',
            'Function ID: [id](https://console.yandex.cloud/folders/folderid/functions/functions/id/overview)',
            'Version ID: vid',
            'Bucket: b',
            'Bucket Object: obj',
            '✅ Success'
        ])
        expect(writeMock).toHaveBeenCalled()
    })
    it('writes only meaningful fields', async () => {
        await main.writeSummary({
            functionName: 'fn',
            functionId: 'id',
            folderId: 'folderid',
            errorMessage: undefined
        })
        expect(addListMock).toHaveBeenCalledWith([
            'Function Name: fn',
            'Function ID: [id](https://console.yandex.cloud/folders/folderid/functions/functions/id/overview)',
            '✅ Success'
        ])
        expect(writeMock).toHaveBeenCalled()
    })
    it('writes error if present', async () => {
        await main.writeSummary({
            functionName: 'fn',
            functionId: 'id',
            folderId: 'folderid',
            errorMessage: 'fail'
        })
        expect(addListMock).toHaveBeenCalledWith([
            'Function Name: fn',
            'Function ID: [id](https://console.yandex.cloud/folders/folderid/functions/functions/id/overview)',
            '❌ Error: fail'
        ])
        expect(writeMock).toHaveBeenCalled()
    })
    it('writes only success if no other fields', async () => {
        await main.writeSummary({})
        expect(addListMock).toHaveBeenCalledWith(['✅ Success'])
        expect(writeMock).toHaveBeenCalled()
    })
})

function setupMockInputs(inputs: Record<string, string>) {
    getInputMock.mockImplementation((name: string) => {
        return inputs[name] || ''
    })
    getBooleanInputMock.mockImplementation((name: string) => {
        return inputs[name] === 'true'
    })
}
