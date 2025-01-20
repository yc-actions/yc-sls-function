import {
    debug,
    endGroup,
    error,
    getBooleanInput,
    getInput,
    getMultilineInput,
    info,
    setCommandEcho,
    setFailed,
    setOutput,
    setSecret,
    startGroup
} from '@actions/core'
import { context } from '@actions/github'
import archiver from 'archiver'
import { WritableStreamBuffer } from 'stream-buffers'
import { minimatch } from 'minimatch'
import { glob } from 'glob'

import { decodeMessage, errors, serviceClients, Session, waitForOperation } from '@yandex-cloud/nodejs-sdk'
import { KB, parseMemory } from './memory'
import { lstatSync } from 'node:fs'
import { fromServiceAccountJsonFile } from './service-account-json'
import {
    CreateFunctionMetadata,
    CreateFunctionRequest,
    CreateFunctionVersionMetadata,
    CreateFunctionVersionRequest,
    ListFunctionsRequest
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function_service'
import { Package } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { StorageServiceImpl } from './storage'
import { StorageObject } from './storage/storage-object'
import { IIAmCredentials } from '@yandex-cloud/nodejs-sdk/dist/types'
import path from 'node:path'
import { parseLogLevel } from './log-level'

type ActionInputs = {
    folderId: string
    functionName: string
    runtime: string
    entrypoint: string
    memory: number
    include: string[]
    excludePattern: string[]
    sourceRoot: string
    executionTimeout: number
    environment: string[]
    serviceAccount: string
    bucket: string
    description: string
    secrets: string[]
    networkId: string
    tags: string[]
    logsDisabled: boolean
    logsGroupId: string
    logLevel: number
}

async function uploadToS3(
    bucket: string,
    functionId: string,
    sessionConfig: IIAmCredentials,
    fileContents: Buffer
): Promise<string> {
    const { GITHUB_SHA } = process.env

    if (!GITHUB_SHA) {
        setFailed('Missing GITHUB_SHA')
        throw new Error('Missing GITHUB_SHA')
    }

    //setting object name
    const bucketObjectName = `${functionId}/${GITHUB_SHA}.zip`
    info(`Upload to bucket: "${bucket}/${bucketObjectName}"`)

    const storageService = new StorageServiceImpl(sessionConfig)

    const storageObject = StorageObject.fromBuffer(bucket, bucketObjectName, fileContents)
    await storageService.putObject(storageObject)
    return bucketObjectName
}

async function getOrCreateFunctionId(session: Session, { folderId, functionName }: ActionInputs): Promise<string> {
    startGroup('Find function id')
    const functionService = session.client(serviceClients.FunctionServiceClient)

    const res = await functionService.list(
        ListFunctionsRequest.fromPartial({
            folderId,
            filter: `name = '${functionName}'`
        })
    )
    let functionId: string
    // If there is a function with the provided name in given folder, then return its id
    if (res.functions.length) {
        functionId = res.functions[0].id
        info(`'There is the function named '${functionName}' in the folder already. Its id is '${functionId}'`)
    } else {
        // Otherwise create new a function and return its id.
        const repo = context.repo

        const op = await functionService.create(
            CreateFunctionRequest.fromPartial({
                folderId,
                name: functionName,
                description: `Created from ${repo.owner}/${repo.repo}`
            })
        )
        const finishedOp = await waitForOperation(op, session)
        if (finishedOp.metadata) {
            functionId = decodeMessage<CreateFunctionMetadata>(finishedOp.metadata).functionId
            info(
                `There was no function named '${functionName}' in the folder. So it was created. Id is '${functionId}'`
            )
        } else {
            error(`Failed to create function '${functionName}'`)
            throw new Error('Failed to create function')
        }
    }
    setOutput('function-id', functionId)
    endGroup()
    return functionId
}

async function run(): Promise<void> {
    setCommandEcho(true)

    try {
        const ycSaJsonCredentials = getInput('yc-sa-json-credentials', {
            required: true
        })
        setSecret(ycSaJsonCredentials)

        const serviceAccountJson = fromServiceAccountJsonFile(JSON.parse(ycSaJsonCredentials))

        const inputs: ActionInputs = {
            folderId: getInput('folder-id', { required: true }),
            functionName: getInput('function-name', { required: true }),
            runtime: getInput('runtime', { required: true }),
            entrypoint: getInput('entrypoint', { required: true }),
            memory: parseMemory(getInput('memory', { required: false }) || '128Mb'),
            include: getMultilineInput('include', { required: false }),
            excludePattern: getMultilineInput('exclude', { required: false }),
            sourceRoot: getInput('source-root', { required: false }) || '.',
            executionTimeout: parseInt(getInput('execution-timeout', { required: false }) || '5', 10),
            environment: getMultilineInput('environment', { required: false }),
            serviceAccount: getInput('service-account', { required: false }),
            bucket: getInput('bucket', { required: false }),
            description: getInput('description', { required: false }),
            secrets: getMultilineInput('secrets', { required: false }),
            networkId: getInput('network-id', { required: false }),
            tags: getMultilineInput('tags', { required: false }),
            logsDisabled: getBooleanInput('logs-disabled', { required: false }) || false,
            logsGroupId: getInput('logs-group-id', { required: false }),
            logLevel: parseLogLevel(getInput('log-level', { required: false, trimWhitespace: true }))
        }

        info('Function inputs set')

        const archive = archiver('zip', { zlib: { level: 9 } })
        const fileContents = await zipSources(inputs, archive)

        info(`Buffer size: ${Buffer.byteLength(fileContents)}b`)

        // Initialize SDK with your token
        const session = new Session({ serviceAccountJson })

        const functionId = await getOrCreateFunctionId(session, inputs)
        let bucketObjectName = ''
        if (inputs.bucket) {
            bucketObjectName = await uploadToS3(inputs.bucket, functionId, serviceAccountJson, fileContents)
        }

        await createFunctionVersion(session, functionId, fileContents, bucketObjectName, inputs)

        setOutput('time', new Date().toTimeString())
    } catch (err) {
        if (err instanceof errors.ApiError) {
            error(`${err.message}\nx-request-id: ${err.requestId}\nx-server-trace-id: ${err.serverTraceId}`)
        }
        setFailed(err as Error)
    }
}

async function createFunctionVersion(
    session: Session,
    functionId: string,
    fileContents: Buffer,
    bucketObjectName: string,
    inputs: ActionInputs
): Promise<void> {
    startGroup('Create function version')
    try {
        info(`Function '${inputs.functionName}' ${functionId}`)

        //convert variables
        info(`Parsed memory: "${inputs.memory}"`)
        info(`Parsed timeout: "${inputs.executionTimeout}"`)

        const request = CreateFunctionVersionRequest.fromJSON({
            functionId,
            runtime: inputs.runtime,
            entrypoint: inputs.entrypoint,
            resources: {
                memory: inputs.memory
            },
            serviceAccountId: inputs.serviceAccount,
            description: inputs.description,
            environment: parseEnvironmentVariables(inputs.environment),
            executionTimeout: { seconds: inputs.executionTimeout },
            secrets: parseLockboxVariables(inputs.secrets),
            tag: inputs.tags,
            connectivity: {
                networkId: inputs.networkId
            },
            logOptions: {
                disabled: inputs.logsDisabled,
                logGroupId: inputs.logsGroupId,
                minLevel: inputs.logLevel
            }
        })

        const functionService = session.client(serviceClients.FunctionServiceClient)

        //get from bucket if supplied
        if (inputs.bucket) {
            info(`From bucket: "${inputs.bucket}"`)

            request.package = Package.fromJSON({
                bucketName: inputs.bucket,
                objectName: bucketObjectName
            })
        } else {
            // 3.5 mb
            if (fileContents.length > 3670016) {
                throw Error(`Zip file is too big: ${fileContents.length} bytes. Provide bucket name.`)
            }
            request.content = fileContents
        }
        // Create new version
        const operation = await functionService.createVersion(request)
        await waitForOperation(operation, session)

        info('Operation complete')
        let metadata
        if (operation.metadata) {
            metadata = decodeMessage<CreateFunctionVersionMetadata>(operation.metadata)
        } else {
            error(`Failed to create function version`)
            throw new Error('Failed to create function version')
        }
        setOutput('version-id', metadata.functionVersionId)
    } catch (err) {
        if ('description' in (err as object)) {
            setFailed((err as { description: string }).description)
        } else {
            setFailed(err as Error)
        }
    } finally {
        endGroup()
    }
}

export interface ZipInputs {
    include: string[]
    excludePattern: string[]
    sourceRoot: string
}

export async function zipSources(inputs: ZipInputs, archive: archiver.Archiver): Promise<Buffer> {
    startGroup('ZipDirectory')

    try {
        const outputStreamBuffer = new WritableStreamBuffer({
            initialSize: 1000 * KB, // start at 1000 kilobytes.
            incrementAmount: 1000 * KB // grow by 1000 kilobytes each time buffer overflows.
        })

        info('Archive initialize')

        archive.on('entry', e => {
            info(`add: ${e.name}`)
        })

        const workspace = process.env['GITHUB_WORKSPACE'] ?? ''
        archive.pipe(outputStreamBuffer)
        const patterns = parseIgnoreGlobPatterns(inputs.excludePattern)
        const root = path.join(workspace, inputs.sourceRoot)
        const includes = inputs.include.filter(x => x.length > 0)
        for (const include of includes) {
            const pathFromSourceRoot = path.join(root, include)
            const matches = glob.sync(pathFromSourceRoot, { absolute: false })
            for (const match of matches) {
                if (lstatSync(match).isDirectory()) {
                    debug(`match:  dir ${match}`)
                    archive.directory(pathFromSourceRoot, include, data => {
                        const res = !patterns.map(p => minimatch(data.name, p)).some(x => x)
                        return res ? data : false
                    })
                } else {
                    debug(`match: file ${match}`)
                    archive.file(match, { name: path.relative(root, match) })
                }
            }
        }

        await archive.finalize()

        info('Archive finalized')

        outputStreamBuffer.end()
        const buffer = outputStreamBuffer.getContents()
        info('Buffer object created')

        if (!buffer) {
            throw Error('Failed to initialize Buffer')
        }

        return buffer
    } finally {
        endGroup()
    }
}

function parseIgnoreGlobPatterns(patterns: string[]): string[] {
    const result: string[] = []

    for (const pattern of patterns) {
        //only not empty patterns
        if (pattern?.length > 0) {
            result.push(pattern)
        }
    }

    info(`Source ignore pattern: "${JSON.stringify(result)}"`)
    return result
}

export function parseEnvironmentVariables(env: string[]): { [s: string]: string } {
    info(`Environment string: "${env}"`)

    const environment: { [key: string]: string } = {}
    for (const line of env) {
        const [key, value] = line.split(/=(.*)/s)
        environment[key.trim()] = value.trim()
    }

    info(`EnvObject: "${JSON.stringify(environment)}"`)
    return environment
}

export type Secret = {
    environmentVariable: string
    id: string
    versionId: string
    key: string
}

// environmentVariable=id/versionId/key
export function parseLockboxVariables(secrets: string[]): Secret[] {
    info(`Secrets string: "${secrets}"`)
    const secretsArr: Secret[] = []

    for (const line of secrets) {
        const [environmentVariable, values] = line.split('=')
        const [id, versionId, key] = values.split('/')
        const secret = { environmentVariable, id, versionId, key } as Secret
        if (!environmentVariable || !id || !key || !versionId) {
            throw new Error(`Broken reference to Lockbox Secret: ${line}`)
        }
        secretsArr.push(secret)
    }

    info(`SecretsObject: "${JSON.stringify(secretsArr)}"`)
    return secretsArr
}

run()
