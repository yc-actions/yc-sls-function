import { StorageObject } from '../storage-object'
import { StorageService } from '../index'

export class StorageServiceImpl implements StorageService {
    static __endpointId = 'storage'

    constructor() {}

    async getObject(bucketName: string, objectName: string): Promise<StorageObject> {
        return StorageObject.fromBuffer(bucketName, objectName, Buffer.from('object'))
    }

    async putObject(): Promise<void> {
        return Promise.resolve()
    }
}
