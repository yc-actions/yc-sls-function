import { IamTokenService } from '@yandex-cloud/nodejs-sdk/dist/token-service/iam-token-service'
import axios from 'axios'
import { IStorageObject, StorageObject } from './storage-object'
import { SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'

interface StorageService {
    getObject(bucketName: string, objectName: string): Promise<IStorageObject>

    putObject(object: object): Promise<void>
}

export class StorageServiceImpl implements StorageService {
    static __endpointId = 'storage'
    private readonly _address: string = 'storage.yandexcloud.net:443'
    private readonly _tokenCreator: () => Promise<string>
    private $method_definitions: unknown

    constructor(sessionConfig: SessionConfig) {
        if ('serviceAccountJson' in sessionConfig) {
            const ts = new IamTokenService(sessionConfig.serviceAccountJson)
            this._tokenCreator = async () => ts.getToken()
        } else if ('iamToken' in sessionConfig) {
            this._tokenCreator = async () => sessionConfig.iamToken
        } else throw new Error('IAMToken not implemented.')

        this.$method_definitions = {}
    }

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

    #_url(bucketName: string, objectName: string): string {
        return `https://${this._address}/${bucketName}/${objectName}`
    }
}
