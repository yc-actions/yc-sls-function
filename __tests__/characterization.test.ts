/**
 * Behavior contract for the deploy logic.
 *
 * Records every Yandex Cloud SDK request the action issues, per input scenario,
 * and snapshots it. The snapshot is captured on the pre-rewrite code and must be
 * reproduced byte-identically by the rewritten code.
 */
// eslint-disable-next-line import/no-namespace
import * as core from '@actions/core'
import { context } from '@actions/github'
import axios from 'axios'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'
import { Version_Status } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'

import { run } from '../src/main'
import { normalize } from '../__fixtures__/normalize-request'
import { __setServiceAccountList, ServiceAccountServiceMock } from './__mocks__/@yandex-cloud/nodejs-sdk/iam-v1'
import {
    __setCreateFunctionFail,
    __setCreateVersionFail,
    __setFunctionList,
    __setVersionList,
    FunctionServiceMock
} from './__mocks__/@yandex-cloud/nodejs-sdk/serverless-functions-v1'
import { __setLockboxVersions } from './__mocks__/@yandex-cloud/nodejs-sdk/lockbox-v1'

jest.mock('../src/storage')

const SA_JSON = `{
    "id": "id",
    "created_at": "2021-01-01T00:00:00Z",
    "key_algorithm": "RSA_2048",
    "service_account_id": "service_account_id",
    "private_key": "private_key",
    "public_key": "public_key"
  }`

const REQUIRED: Record<string, string> = {
    'folder-id': 'folderid',
    'function-name': 'my-function',
    runtime: 'nodejs16',
    entrypoint: 'index.handler',
    'logs-disabled': 'false',
    async: 'false'
}

const SCENARIOS: Array<{ name: string; inputs: Record<string, string>; setup?: () => void }> = [
    {
        name: 'required inputs only, inline upload, SA JSON credentials',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON }
    },
    {
        name: 'bucket upload',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON, bucket: 'some-bucket' }
    },
    {
        name: 'IAM token credentials',
        inputs: { ...REQUIRED, 'yc-iam-token': 'iam-token-input' }
    },
    {
        name: 'workload identity federation credentials',
        inputs: { ...REQUIRED, 'yc-sa-id': 'wif-sa-id' }
    },
    {
        name: 'environment, tags, network, description, timeout, memory',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            memory: '256Mb',
            'execution-timeout': '30',
            environment: 'FOO=BAR\nFOO2=BAR2',
            description: 'some description',
            'network-id': 'networkid',
            tags: 'tag1\ntag2',
            'service-account': 'serviceaccountid'
        }
    },
    {
        name: 'service account resolved by name',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON, 'service-account-name': 'service-account-name' },
        setup: () =>
            __setServiceAccountList([ServiceAccount.fromJSON({ id: 'serviceaccountid', name: 'service-account-name' })])
    },
    {
        name: 'log options',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            'logs-disabled': 'true',
            'logs-group-id': 'logsgroupid',
            'log-level': 'WARN'
        }
    },
    {
        name: 'mounts',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            mounts: 'data:my-bucket\nimages:my-bucket/photos:ro'
        }
    },
    {
        name: 'secrets with explicit version',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON, secrets: 'ENV_VAR_1=secret-id/verid/VAR_1' }
    },
    {
        name: 'secrets with latest version resolved',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON, secrets: 'ENV_VAR_1=secret-id/latest/VAR_1' },
        setup: () =>
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
                }
            ])
    },
    {
        name: 'async with both ymq targets',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            async: 'true',
            'async-sa-id': 'async-sa-id',
            'async-retries-count': '3',
            'async-success-ymq-arn': 'arn:aws:sqs:us-east-1:123456789012:queue-name',
            'async-success-sa-id': 'success-sa-id',
            'async-failure-ymq-arn': 'arn:aws:sqs:us-east-1:123456789012:queue-name',
            'async-failure-sa-id': 'failure-sa-id'
        }
    },
    {
        name: 'async with empty targets falling back to function service account',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            async: 'true',
            'service-account': 'serviceaccountid'
        }
    },
    {
        name: 'function already exists',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON },
        setup: () =>
            __setFunctionList([
                (
                    jest.requireActual(
                        '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
                    ) as typeof import('@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function')
                ).Function.fromJSON({
                    id: 'functionid',
                    name: 'my-function',
                    folder_id: 'folderid',
                    status: 'ACTIVE'
                })
            ])
    },
    {
        name: 'function creation fails',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON },
        setup: () => __setCreateFunctionFail(true)
    },
    {
        name: 'version creation fails',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON },
        setup: () => __setCreateVersionFail(true)
    }
]

describe('characterization', () => {
    let tmpSummaryFile: string

    beforeEach(() => {
        tmpSummaryFile = path.join(os.tmpdir(), `gh-summary-characterization`)
        process.env.GITHUB_STEP_SUMMARY = tmpSummaryFile
        fs.writeFileSync(tmpSummaryFile, '', { flag: 'w' })
        process.env.GITHUB_REPOSITORY = 'owner/repo'
        process.env.GITHUB_SHA = 'sha'

        jest.clearAllMocks()
        jest.spyOn(core, 'error').mockImplementation()
        jest.spyOn(core, 'setFailed').mockImplementation()
        jest.spyOn(core, 'setOutput').mockImplementation()
        jest.spyOn(core, 'getIDToken').mockImplementation(async () => 'github-token')
        jest.spyOn(axios, 'post').mockImplementation(async () => ({
            status: 200,
            data: { access_token: 'iam-token' }
        }))
        jest.spyOn(context, 'repo', 'get').mockImplementation(() => ({
            owner: 'some-owner',
            repo: 'some-repo'
        }))

        __setServiceAccountList([ServiceAccount.fromJSON({ id: 'serviceaccountid' })])
        __setFunctionList([])
        __setVersionList([])
        __setLockboxVersions([])
        __setCreateFunctionFail(false)
        __setCreateVersionFail(false)
    })

    afterEach(() => {
        jest.restoreAllMocks()
        if (tmpSummaryFile && fs.existsSync(tmpSummaryFile)) {
            fs.unlinkSync(tmpSummaryFile)
        }
        delete process.env.GITHUB_STEP_SUMMARY
    })

    for (const scenario of SCENARIOS) {
        it(`records SDK requests: ${scenario.name}`, async () => {
            jest.spyOn(core, 'getInput').mockImplementation((name: string) => scenario.inputs[name] || '')
            jest.spyOn(core, 'getBooleanInput').mockImplementation((name: string) => scenario.inputs[name] === 'true')
            jest.spyOn(core, 'getMultilineInput').mockImplementation((name: string) =>
                scenario.inputs[name] ? scenario.inputs[name].split('\n') : []
            )
            scenario.setup?.()

            await run()

            expect({
                listFunctions: normalize(FunctionServiceMock.list.mock.calls),
                createFunction: normalize(FunctionServiceMock.create.mock.calls),
                createVersion: normalize(FunctionServiceMock.createVersion.mock.calls),
                listServiceAccounts: normalize(ServiceAccountServiceMock.list.mock.calls)
            }).toMatchSnapshot()
        })
    }
})
