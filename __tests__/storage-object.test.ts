import { expect, test } from '@jest/globals'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StorageObject } from '../src/storage/storage-object.js'

describe('StorageObject', () => {
    describe('constructor', () => {
        test('it should keep bucket name, object name and buffer promise as given', async () => {
            const bufferPromise = Promise.resolve(Buffer.from('payload'))
            const object = new StorageObject('bucket', 'object', bufferPromise)

            expect(object.bucketName).toBe('bucket')
            expect(object.objectName).toBe('object')
            expect(object.bufferPromise).toBe(bufferPromise)
            await expect(object.bufferPromise).resolves.toEqual(Buffer.from('payload'))
        })
    })

    describe('fromFile', () => {
        let tmpDir: string

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-object-'))
        })

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        })

        test('it should read the file contents into the buffer promise', async () => {
            const fileName = path.join(tmpDir, 'payload.txt')
            fs.writeFileSync(fileName, 'file contents')

            const object = StorageObject.fromFile('bucket', 'object', fileName)

            expect(object).toBeInstanceOf(StorageObject)
            expect(object.bucketName).toBe('bucket')
            expect(object.objectName).toBe('object')
            await expect(object.bufferPromise).resolves.toEqual(Buffer.from('file contents'))
        })

        test('it should read binary files without corrupting them', async () => {
            const fileName = path.join(tmpDir, 'payload.bin')
            const contents = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f])
            fs.writeFileSync(fileName, contents)

            const object = StorageObject.fromFile('bucket', 'object', fileName)

            await expect(object.bufferPromise).resolves.toEqual(contents)
        })

        test('it should reject the buffer promise when the file cannot be read', async () => {
            const object = StorageObject.fromFile('bucket', 'object', path.join(tmpDir, 'does-not-exist.txt'))

            await expect(object.bufferPromise).rejects.toThrow(/ENOENT/)
        })
    })

    describe('fromString', () => {
        test('it should encode the content as utf-8', async () => {
            const object = StorageObject.fromString('bucket', 'object', 'привет')

            expect(object.bucketName).toBe('bucket')
            expect(object.objectName).toBe('object')
            await expect(object.bufferPromise).resolves.toEqual(Buffer.from('привет', 'utf-8'))
        })

        test('it should support empty content', async () => {
            const object = StorageObject.fromString('bucket', 'object', '')

            await expect(object.bufferPromise).resolves.toEqual(Buffer.alloc(0))
        })
    })

    describe('fromBuffer', () => {
        test('it should resolve to the very same buffer', async () => {
            const buffer = Buffer.from('payload')
            const object = StorageObject.fromBuffer('bucket', 'object', buffer)

            expect(object.bucketName).toBe('bucket')
            expect(object.objectName).toBe('object')
            await expect(object.bufferPromise).resolves.toBe(buffer)
        })
    })

    describe('getData', () => {
        test.each([
            ['utf-8' as const, 'payload'],
            ['base64' as const, Buffer.from('payload').toString('base64')],
            ['hex' as const, Buffer.from('payload').toString('hex')]
        ])('it should decode the buffer using the %s encoding', async (encoding, expected) => {
            const object = StorageObject.fromString('bucket', 'object', 'payload')

            await expect(object.getData(encoding)).resolves.toBe(expected)
        })

        test('it should fall back to utf-8 when no encoding is provided', async () => {
            const object = StorageObject.fromString('bucket', 'object', 'привет')

            // The parameter is declared as required, but the implementation defaults it, and
            // JavaScript callers can reach this branch.
            await expect(object.getData(undefined as unknown as BufferEncoding)).resolves.toBe('привет')
        })

        test('it should propagate a rejected buffer promise', async () => {
            const object = new StorageObject('bucket', 'object', Promise.reject(new Error('read failed')))

            await expect(object.getData('utf-8')).rejects.toThrow('read failed')
        })
    })
})
