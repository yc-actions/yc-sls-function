import { jest } from '@jest/globals'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'
import { Function } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { Version_Status } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'

import * as core from '../__fixtures__/core.js'
import * as github from '../__fixtures__/github.js'
import * as axios from '../__fixtures__/axios.js'
import * as storage from '../__fixtures__/storage.js'
import * as sdk from '../__fixtures__/yandex-sdk/index.js'
import {
    __setServiceAccountList,
    ServiceAccountServiceMock,
    serviceAccountService
} from '../__fixtures__/yandex-sdk/iam-v1.js'
import {
    __setCreateFunctionFail,
    __setCreateVersionFail,
    __setFunctionList,
    __setVersionList,
    FunctionServiceMock,
    functionService
} from '../__fixtures__/yandex-sdk/serverless-functions-v1.js'
import { __setLockboxVersions, secretService } from '../__fixtures__/yandex-sdk/lockbox-v1.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => github)
jest.unstable_mockModule('axios', () => axios)
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk', () => sdk)
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk/iam-v1', () => ({ serviceAccountService }))
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk/lockbox-v1', () => ({ secretService }))
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk/serverless-functions-v1', () => ({ functionService }))
jest.unstable_mockModule('../src/storage/index.js', () => storage)

const { run } = await import('../src/main.js')
const { writeSummary } = await import('../src/summary.js')

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
    'source-root': '.',
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

        expect(core.setOutput).toHaveBeenCalledWith('function-id', 'functionid')
        expect(core.setOutput).toHaveBeenCalledWith('version-id', 'versionid')
        expect(core.setOutput).toHaveBeenCalledWith('time', expect.any(String))
        expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should run with all inputs', async () => {
        setupMockInputs({ ...defaultValues, ...ycSaJsonCredentials })

        await run()

        expect(core.setOutput).toHaveBeenCalledWith('function-id', 'functionid')
        expect(core.setOutput).toHaveBeenCalledWith('version-id', 'versionid')
        expect(core.setOutput).toHaveBeenCalledWith('time', expect.any(String))
        expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should run with async inputs', async () => {
        setupMockInputs({ ...asyncInputs, ...ycSaJsonCredentials })

        await run()

        expect(core.setOutput).toHaveBeenCalledWith('function-id', 'functionid')
        expect(core.setOutput).toHaveBeenCalledWith('version-id', 'versionid')
        expect(core.setOutput).toHaveBeenCalledWith('time', expect.any(String))
        expect(core.setFailed).not.toHaveBeenCalled()
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
        expect(core.setOutput).toHaveBeenCalledWith('function-id', 'functionid')
        expect(core.setOutput).toHaveBeenCalledWith('version-id', 'versionid')
        expect(core.setFailed).not.toHaveBeenCalled()

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
            Function.fromJSON({
                id: 'functionid',
                name: 'my-function',
                folder_id: 'folderid',
                status: 'ACTIVE'
            })
        ])

        await run()

        expect(core.setOutput).toHaveBeenCalledWith('version-id', 'versionid')
        expect(core.setOutput).toHaveBeenCalledWith('time', expect.any(String))
        expect(core.setFailed).not.toHaveBeenCalled()
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

        expect(core.setOutput).toHaveBeenCalledWith('function-id', 'functionid')
        expect(core.setOutput).toHaveBeenCalledWith('version-id', 'versionid')
        expect(core.setOutput).toHaveBeenCalledWith('time', expect.any(String))
        expect(core.setFailed).not.toHaveBeenCalled()
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
    let tmpSummaryFile: string
    beforeEach(() => {
        // Set GITHUB_STEP_SUMMARY to a temp file
        tmpSummaryFile = path.join(os.tmpdir(), `gh-summary-${Date.now()}`)
        process.env.GITHUB_STEP_SUMMARY = tmpSummaryFile
        fs.writeFileSync(tmpSummaryFile, '', { flag: 'w' }) // Ensure file exists and is writable
        jest.clearAllMocks()
    })
    afterEach(() => {
        jest.clearAllMocks()
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
        expect(core.addHeading).toHaveBeenCalledWith('Yandex Cloud Function Deployment Summary', 2)
        expect(core.addList).toHaveBeenCalledWith([
            'Function Name: fn',
            'Function ID: <a href="https://console.yandex.cloud/folders/folderid/functions/functions/id/overview">id</a>',
            'Version ID: vid',
            'Bucket: b',
            'Bucket Object: obj',
            '✅ Success'
        ])
        expect(core.write).toHaveBeenCalled()
    })
    it('writes only meaningful fields', async () => {
        await writeSummary({
            functionName: 'fn',
            functionId: 'id',
            folderId: 'folderid',
            errorMessage: undefined
        })
        expect(core.addList).toHaveBeenCalledWith([
            'Function Name: fn',
            'Function ID: <a href="https://console.yandex.cloud/folders/folderid/functions/functions/id/overview">id</a>',
            '✅ Success'
        ])
        expect(core.write).toHaveBeenCalled()
    })
    it('writes error if present', async () => {
        await writeSummary({
            functionName: 'fn',
            functionId: 'id',
            folderId: 'folderid',
            errorMessage: 'fail'
        })
        expect(core.addList).toHaveBeenCalledWith([
            'Function Name: fn',
            'Function ID: <a href="https://console.yandex.cloud/folders/folderid/functions/functions/id/overview">id</a>',
            '❌ Error: fail'
        ])
        expect(core.write).toHaveBeenCalled()
    })
    it('writes only success if no other fields', async () => {
        await writeSummary({})
        expect(core.addList).toHaveBeenCalledWith(['✅ Success'])
        expect(core.write).toHaveBeenCalled()
    })
})

function setupMockInputs(inputs: Record<string, string>) {
    core.getInput.mockImplementation((name: string) => inputs[name] || '')
    core.getBooleanInput.mockImplementation((name: string) => inputs[name] === 'true')
    core.getMultilineInput.mockImplementation((name: string) => (inputs[name] ? inputs[name].split('\n') : []))
}
