import { jest } from '@jest/globals'
import { StorageObject } from '../src/storage/storage-object.js'

export const putObject = jest.fn<(object: object) => Promise<void>>(async () => undefined)

export class StorageServiceImpl {
    static __endpointId = 'storage'

    async getObject(bucketName: string, objectName: string): Promise<StorageObject> {
        return StorageObject.fromBuffer(bucketName, objectName, Buffer.from('object'))
    }

    async putObject(object: object): Promise<void> {
        return putObject(object)
    }
}
