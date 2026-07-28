import { jest } from '@jest/globals'
import { Buffer } from 'node:buffer'
import { IIAmCredentials, SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'

const get = jest.fn<(url: string, config?: unknown) => Promise<{ data: unknown }>>()
const put = jest.fn<(url: string, body?: unknown, config?: unknown) => Promise<unknown>>()

jest.unstable_mockModule('axios', () => ({
    default: { get, put },
    get,
    put
}))

const getToken = jest.fn<() => Promise<string>>()
const IamTokenService = jest.fn((credentials: IIAmCredentials) => ({ credentials, getToken }))

jest.unstable_mockModule('@yandex-cloud/nodejs-sdk/dist/token-service/iam-token-service', () => ({
    IamTokenService
}))

const { StorageServiceImpl } = await import('../src/storage/index.js')
const { StorageObject } = await import('../src/storage/storage-object.js')

const serviceAccountJson: IIAmCredentials = {
    serviceAccountId: 'service-account-id',
    accessKeyId: 'access-key-id',
    privateKey: 'private-key'
}

describe('StorageServiceImpl', () => {
    beforeEach(() => {
        get.mockReset()
        put.mockReset()
        getToken.mockReset()
        IamTokenService.mockClear()

        get.mockResolvedValue({ data: Buffer.from('object contents') })
        put.mockResolvedValue(undefined)
        getToken.mockResolvedValue('sa-iam-token')
    })

    describe('constructor', () => {
        test('it should build tokens from the service account json', async () => {
            const service = new StorageServiceImpl({ serviceAccountJson })

            expect(IamTokenService).toHaveBeenCalledWith(serviceAccountJson)

            await service.putObject(StorageObject.fromString('bucket', 'object', 'payload'))

            expect(getToken).toHaveBeenCalledTimes(1)
            expect(put).toHaveBeenCalledWith(
                expect.any(String),
                expect.anything(),
                expect.objectContaining({
                    headers: { 'X-YaCloud-SubjectToken': 'sa-iam-token' }
                })
            )
        })

        test('it should request a fresh token for every call', async () => {
            const service = new StorageServiceImpl({ serviceAccountJson })

            await service.putObject(StorageObject.fromString('bucket', 'object', 'payload'))
            await service.putObject(StorageObject.fromString('bucket', 'other', 'payload'))

            expect(IamTokenService).toHaveBeenCalledTimes(1)
            expect(getToken).toHaveBeenCalledTimes(2)
        })

        test('it should use the iam token as is', async () => {
            const service = new StorageServiceImpl({ iamToken: 'plain-iam-token' })

            expect(IamTokenService).not.toHaveBeenCalled()

            await service.putObject(StorageObject.fromString('bucket', 'object', 'payload'))

            expect(put).toHaveBeenCalledWith(
                expect.any(String),
                expect.anything(),
                expect.objectContaining({
                    headers: { 'X-YaCloud-SubjectToken': 'plain-iam-token' }
                })
            )
        })

        test.each([
            ['empty config', {}],
            ['oauth token config', { oauthToken: 'oauth-token' }]
        ])('it should throw when %s provides no supported credentials', (_name, sessionConfig) => {
            expect(() => new StorageServiceImpl(sessionConfig as SessionConfig)).toThrow('IAMToken not implemented.')
        })
    })

    describe('putObject', () => {
        test('it should upload the resolved buffer to the object url', async () => {
            const service = new StorageServiceImpl({ iamToken: 'plain-iam-token' })
            const buffer = Buffer.from('zip contents')

            await service.putObject(StorageObject.fromBuffer('my-bucket', 'func-id/sha.zip', buffer))

            expect(put).toHaveBeenCalledTimes(1)
            expect(put).toHaveBeenCalledWith('https://storage.yandexcloud.net:443/my-bucket/func-id/sha.zip', buffer, {
                headers: { 'X-YaCloud-SubjectToken': 'plain-iam-token' },
                maxBodyLength: 128 * 1024 * 1024
            })
        })

        test('it should wait for a lazy buffer promise before uploading', async () => {
            const service = new StorageServiceImpl({ iamToken: 'plain-iam-token' })
            const buffer = Buffer.from('lazy contents')
            const bufferPromise = new Promise<Buffer>(resolve => {
                setTimeout(() => resolve(buffer), 10)
            })

            await service.putObject(new StorageObject('my-bucket', 'object', bufferPromise))

            expect(put).toHaveBeenCalledWith(expect.any(String), buffer, expect.anything())
        })

        test('it should propagate a rejected buffer promise without calling axios', async () => {
            const service = new StorageServiceImpl({ iamToken: 'plain-iam-token' })

            await expect(
                service.putObject(new StorageObject('my-bucket', 'object', Promise.reject(new Error('zip failed'))))
            ).rejects.toThrow('zip failed')

            expect(put).not.toHaveBeenCalled()
        })

        test('it should propagate upload failures', async () => {
            put.mockRejectedValue(new Error('Request failed with status code 403'))
            const service = new StorageServiceImpl({ iamToken: 'plain-iam-token' })

            await expect(service.putObject(StorageObject.fromString('my-bucket', 'object', 'payload'))).rejects.toThrow(
                'Request failed with status code 403'
            )
        })

        test('it should propagate token creation failures without calling axios', async () => {
            getToken.mockRejectedValue(new Error('cannot issue IAM token'))
            const service = new StorageServiceImpl({ serviceAccountJson })

            await expect(service.putObject(StorageObject.fromString('my-bucket', 'object', 'payload'))).rejects.toThrow(
                'cannot issue IAM token'
            )

            expect(put).not.toHaveBeenCalled()
        })
    })

    describe('getObject', () => {
        test('it should download the object and wrap it into a StorageObject', async () => {
            const service = new StorageServiceImpl({ iamToken: 'plain-iam-token' })

            const object = await service.getObject('my-bucket', 'func-id/sha.zip')

            expect(get).toHaveBeenCalledTimes(1)
            expect(get).toHaveBeenCalledWith('https://storage.yandexcloud.net:443/my-bucket/func-id/sha.zip', {
                headers: { 'X-YaCloud-SubjectToken': 'plain-iam-token' },
                responseType: 'arraybuffer'
            })
            expect(object).toBeInstanceOf(StorageObject)
            expect(object.bucketName).toBe('my-bucket')
            expect(object.objectName).toBe('func-id/sha.zip')
            await expect(object.bufferPromise).resolves.toEqual(Buffer.from('object contents'))
            await expect(object.getData('utf-8')).resolves.toBe('object contents')
        })

        test('it should authenticate with a token issued from the service account json', async () => {
            const service = new StorageServiceImpl({ serviceAccountJson })

            await service.getObject('my-bucket', 'object')

            expect(get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ headers: { 'X-YaCloud-SubjectToken': 'sa-iam-token' } })
            )
        })

        test('it should propagate download failures', async () => {
            get.mockRejectedValue(new Error('Request failed with status code 404'))
            const service = new StorageServiceImpl({ iamToken: 'plain-iam-token' })

            await expect(service.getObject('my-bucket', 'missing')).rejects.toThrow(
                'Request failed with status code 404'
            )
        })
    })

    test('it should expose the storage endpoint id', () => {
        expect(StorageServiceImpl.__endpointId).toBe('storage')
    })
})
