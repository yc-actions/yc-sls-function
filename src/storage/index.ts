/**
 * Yandex Object Storage (S3-compatible) client implementation.
 *
 * Handles authentication via IAM tokens (from SA JSON or direct token)
 * and provides get/put operations for bucket objects.
 *
 * @module
 */

import { IamTokenService } from '@yandex-cloud/nodejs-sdk/dist/token-service/iam-token-service'
import axios from 'axios'
import { IStorageObject, StorageObject } from './storage-object'
import { SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'

/**
 * Interface for Yandex Object Storage operations.
 */
export interface StorageService {
    /**
     * Retrieves object from bucket.
     *
     * @param bucketName - S3 bucket name
     * @param objectName - Object key within bucket
     * @returns Storage object with lazy-loaded buffer
     */
    getObject(bucketName: string, objectName: string): Promise<IStorageObject>

    /**
     * Uploads object to bucket.
     *
     * @param object - Storage object with bucket name, object name, and buffer promise
     */
    putObject(object: object): Promise<void>
}

/**
 * Yandex Object Storage client using axios HTTP client.
 *
 * Authenticates with X-YaCloud-SubjectToken header containing IAM token.
 * Token is created on-demand from service account JSON or provided IAM token.
 */
export class StorageServiceImpl implements StorageService {
    static __endpointId = 'storage'
    private readonly _address: string = 'storage.yandexcloud.net:443'
    private readonly _tokenCreator: () => Promise<string>
    private $method_definitions: unknown

    /**
     * Creates storage service with authentication configuration.
     *
     * @param sessionConfig - Session config with serviceAccountJson or iamToken
     * @throws {Error} If session config doesn't contain valid auth method
     */
    constructor(sessionConfig: SessionConfig) {
        if ('serviceAccountJson' in sessionConfig) {
            const ts = new IamTokenService(sessionConfig.serviceAccountJson)
            this._tokenCreator = async () => ts.getToken()
        } else if ('iamToken' in sessionConfig) {
            this._tokenCreator = async () => sessionConfig.iamToken
        } else throw new Error('IAMToken not implemented.')

        this.$method_definitions = {}
    }

    /**
     * Fetches object from Yandex Object Storage.
     *
     * @param bucketName - Bucket name
     * @param objectName - Object key
     * @returns Storage object wrapper with buffer
     */
    async getObject(bucketName: string, objectName: string): Promise<StorageObject> {
        const token = await this._tokenCreator()
        const res = await axios.get(this.#_url(bucketName, objectName), {
            headers: {
                'X-YaCloud-SubjectToken': token
            }
        })
        const buf = await res.data()
        return StorageObject.fromBuffer(bucketName, objectName, buf)
    }

    /**
     * Uploads object to Yandex Object Storage.
     *
     * Supports uploads up to 128MB (maxBodyLength).
     *
     * @param storageObject - Object with bucketName, objectName, and bufferPromise
     * @throws {Error} If upload fails or exceeds size limit
     */
    async putObject({ bucketName, bufferPromise, objectName }: IStorageObject): Promise<void> {
        const token = await this._tokenCreator()
        const buffer = await bufferPromise
        await axios.put(this.#_url(bucketName, objectName), buffer, {
            headers: {
                'X-YaCloud-SubjectToken': token
            },
            maxBodyLength: 128 * 1024 * 1024
        })
    }

    /**
     * Constructs storage.yandexcloud.net URL for object.
     *
     * @param bucketName - Bucket name
     * @param objectName - Object key
     * @returns HTTPS URL: `https://storage.yandexcloud.net/{bucket}/{object}`
     */
    #_url(bucketName: string, objectName: string): string {
        return `https://${this._address}/${bucketName}/${objectName}`
    }
}
