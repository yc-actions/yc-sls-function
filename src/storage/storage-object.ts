/**
 * Storage object abstraction for Yandex Object Storage.
 *
 * Wraps buffer operations with lazy loading support via promises.
 *
 * @module
 */

import { Buffer } from 'node:buffer'
import fs from 'node:fs'

/**
 * Interface for storage object with lazy-loaded buffer.
 */
export interface IStorageObject {
    /** Bucket name */
    bucketName: string

    /** Promise resolving to object contents buffer */
    bufferPromise: Promise<Buffer>

    /** Object key within bucket */
    objectName: string
}

/**
 * Storage object implementation with factory methods for different sources.
 */
export class StorageObject implements IStorageObject {
    bucketName: string
    objectName: string
    bufferPromise: Promise<Buffer>

    constructor(bucketName: string, objectName: string, bufferPromise: Promise<Buffer>) {
        this.bucketName = bucketName
        this.objectName = objectName
        this.bufferPromise = bufferPromise
    }

    /**
     * Creates storage object from file on disk.
     *
     * @param bucketName - Target bucket name
     * @param objectName - Target object key
     * @param fileName - Local file path to read
     * @returns Storage object with async file read
     */
    static fromFile(bucketName: string, objectName: string, fileName: string): StorageObject {
        return new this(
            bucketName,
            objectName,
            new Promise((resolve, reject) => {
                fs.readFile(fileName, (err: unknown, data: Buffer | PromiseLike<Buffer>) => {
                    if (err) {
                        return reject(err)
                    }

                    return resolve(data)
                })
            })
        )
    }

    /**
     * Creates storage object from string content.
     *
     * @param bucketName - Target bucket name
     * @param objectName - Target object key
     * @param content - String content (UTF-8 encoded)
     * @returns Storage object with string buffer
     */
    static fromString(bucketName: string, objectName: string, content: string): StorageObject {
        return this.fromBuffer(bucketName, objectName, Buffer.from(content, 'utf-8'))
    }

    /**
     * Creates storage object from existing buffer.
     *
     * @param bucketName - Target bucket name
     * @param objectName - Target object key
     * @param buffer - Pre-loaded buffer
     * @returns Storage object with resolved buffer promise
     */
    static fromBuffer(bucketName: string, objectName: string, buffer: Buffer): StorageObject {
        return new this(
            bucketName,
            objectName,
            new Promise(resolve => {
                resolve(buffer)
            })
        )
    }

    /**
     * Retrieves object data as string.
     *
     * @param encoding - Character encoding (default: 'utf-8')
     * @returns String representation of buffer contents
     */
    async getData(encoding: BufferEncoding): Promise<string> {
        encoding = encoding || 'utf-8'
        const buffer = await this.bufferPromise
        return buffer.toString(encoding)
    }
}
