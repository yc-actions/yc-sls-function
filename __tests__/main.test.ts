import * as core from '@actions/core'

import { run, writeSummary } from '../src/main'

import { context } from '@actions/github'
import axios from 'axios'
import { Instance } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/compute/v1/instance'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { __setServiceAccountList, ServiceAccountServiceMock } from './__mocks__/@yandex-cloud/nodejs-sdk/iam-v1'
import {
    __setCreateFunctionFail,
    __setCreateVersionFail,
    __setFunctionList,
    __setVersionList,
    FunctionServiceMock
} from './__mocks__/@yandex-cloud/nodejs-sdk/serverless-functions-v1'
import { __setLockboxVersions } from './__mocks__/@yandex-cloud/nodejs-sdk/lockbox-v1'
import { Version_Status } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'

jest.mock('../src/storage')

// Mock the GitHub Actions core library
let errorMock: jest.SpyInstance
let getInputMock: jest.SpyInstance
let getMultipleInputMock: jest.SpyInstance
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
        getMultipleInputMock = jest.spyOn(core, 'getMultilineInput').mockImplementation()
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

        await run()

        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
    })

    it('should run with all inputs', async () => {
        setupMockInputs({ ...defaultValues, ...ycSaJsonCredentials })

        await run()

        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
    })

    it('should run with async inputs', async () => {
        setupMockInputs({ ...asyncInputs, ...ycSaJsonCredentials })

        await run()

        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(FunctionServiceMock.createVersion).toHaveBeenCalledWith(
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

        await run()
        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setFailedMock).not.toHaveBeenCalled()

        expect(FunctionServiceMock.createVersion).toHaveBeenCalledWith(
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

        await run()

        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(FunctionServiceMock.create).not.toHaveBeenCalled()
    })

    it('should resolve service account id from name', async () => {
        setupMockInputs({ ...requiredInputs, ...ycSaJsonCredentials, 'service-account-name': 'service-account-name' })
        __setServiceAccountList([
            ServiceAccount.fromJSON({
                id: 'serviceaccountid',
                name: 'service-account-name'
            })
        ])

        await run()

        expect(setOutputMock).toHaveBeenCalledWith('function-id', 'functionid')
        expect(setOutputMock).toHaveBeenCalledWith('version-id', 'versionid')
        expect(setOutputMock).toHaveBeenCalledWith('time', expect.any(String))
        expect(setFailedMock).not.toHaveBeenCalled()
        expect(FunctionServiceMock.createVersion).toHaveBeenCalledWith(
            expect.objectContaining({
                serviceAccountId: 'serviceaccountid'
            })
        )
        expect(ServiceAccountServiceMock.list).toHaveBeenCalledWith(
            expect.objectContaining({
                folderId: 'folderid',
                filter: 'name = "service-account-name"'
            })
        )
    })

    it('should resolve lockbox secret versionId "latest" to the actual latest version', async () => {
        setupMockInputs({
            ...requiredInputs,
            ...ycSaJsonCredentials,
            secrets: 'ENV_VAR_1=secret-id/latest/VAR_1'
        })

        // Set Lockbox versions using the centralized mock
        __setLockboxVersions([
            {
                id: 'v1',
                createdAt: new Date('2023-01-01T00:00:00Z'),
                secretId: '',
                description: '',
                status: Version_Status.STATUS_UNSPECIFIED,
                payloadEntryKeys: []
            },
            {
                id: 'v2',
                createdAt: new Date('2024-01-01T00:00:00Z'),
                secretId: '',
                description: '',
                status: Version_Status.ACTIVE,
                payloadEntryKeys: []
            }, // latest
            {
                id: 'v0',
                createdAt: new Date('2022-01-01T00:00:00Z'),
                secretId: '',
                description: '',
                status: Version_Status.STATUS_UNSPECIFIED,
                payloadEntryKeys: []
            }
        ])

        await run()

        // Check that the latest versionId was used
        expect(FunctionServiceMock.createVersion).toHaveBeenCalledWith(
            expect.objectContaining({
                secrets: expect.arrayContaining([
                    expect.objectContaining({
                        environmentVariable: 'ENV_VAR_1',
                        id: 'secret-id',
                        versionId: 'v2', // latest
                        key: 'VAR_1'
                    })
                ])
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
    it('writes all fields with function id as html link', async () => {
        await writeSummary({
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
            'Function ID: <a href="https://console.yandex.cloud/folders/folderid/functions/functions/id/overview">id</a>',
            'Version ID: vid',
            'Bucket: b',
            'Bucket Object: obj',
            '✅ Success'
        ])
        expect(writeMock).toHaveBeenCalled()
    })
    it('writes only meaningful fields', async () => {
        await writeSummary({
            functionName: 'fn',
            functionId: 'id',
            folderId: 'folderid',
            errorMessage: undefined
        })
        expect(addListMock).toHaveBeenCalledWith([
            'Function Name: fn',
            'Function ID: <a href="https://console.yandex.cloud/folders/folderid/functions/functions/id/overview">id</a>',
            '✅ Success'
        ])
        expect(writeMock).toHaveBeenCalled()
    })
    it('writes error if present', async () => {
        await writeSummary({
            functionName: 'fn',
            functionId: 'id',
            folderId: 'folderid',
            errorMessage: 'fail'
        })
        expect(addListMock).toHaveBeenCalledWith([
            'Function Name: fn',
            'Function ID: <a href="https://console.yandex.cloud/folders/folderid/functions/functions/id/overview">id</a>',
            '❌ Error: fail'
        ])
        expect(writeMock).toHaveBeenCalled()
    })
    it('writes only success if no other fields', async () => {
        await writeSummary({})
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
    getMultipleInputMock.mockImplementation((name: string) => {
        return inputs[name] ? inputs[name].split('\n') : []
    })
}
