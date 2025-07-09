import { expect, test, describe } from '@jest/globals'
import { parseMounts } from '../src/parse'
import {
    Mount,
    Mount_Mode
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'

describe('mounts', () => {
    test('should parse valid short syntax lines', () => {
        const input = [
            'data:my-bucket',
            'images:my-bucket/photos',
            'logs:my-bucket:ro',
            'images:my-bucket/photos:ro',
            'mount:bucket/prefix',
            'mount:bucket/prefix:ro'
        ]
        const expected: Mount[] = [
            Mount.fromPartial({
                name: 'data',
                mode: Mount_Mode.READ_WRITE,
                objectStorage: { bucketId: 'my-bucket' }
            }),
            Mount.fromPartial({
                name: 'images',
                mode: Mount_Mode.READ_WRITE,
                objectStorage: { bucketId: 'my-bucket', prefix: 'photos' }
            }),
            Mount.fromPartial({
                name: 'logs',
                mode: Mount_Mode.READ_ONLY,
                objectStorage: { bucketId: 'my-bucket' }
            }),
            Mount.fromPartial({
                name: 'images',
                mode: Mount_Mode.READ_ONLY,
                objectStorage: { bucketId: 'my-bucket', prefix: 'photos' }
            }),
            Mount.fromPartial({
                name: 'mount',
                mode: Mount_Mode.READ_WRITE,
                objectStorage: { bucketId: 'bucket', prefix: 'prefix' }
            }),
            Mount.fromPartial({
                name: 'mount',
                mode: Mount_Mode.READ_ONLY,
                objectStorage: { bucketId: 'bucket', prefix: 'prefix' }
            })
        ]
        expect(parseMounts(input)).toEqual(expected)
    })

    test('should ignore empty lines', () => {
        const input = ['']
        const expected: Mount[] = []
        expect(parseMounts(input)).toEqual(expected)
    })

    test.each([
        'bucketonly',
        'bucket:',
        ':bucket',
        'mount:bucket:extra:ro',
        'mount:bucket/prefix:extra',
        'mount:bucket:rw', // only :ro is allowed
        'mount:bucket/prefix:rw',
        'mount:bucket/prefix:ro:extra',
        'mount:bucket/prefix:ro:another',
        'mount::bucket',
        'mount:',
        'mount',
        '::',
        ':/',
        'mount:bucket:/:ro' // prefix cannot be empty string with slash only
    ])('should throw on invalid input "%s"', input => {
        expect(() => parseMounts([input])).toThrow()
    })

    test('should allow prefix to be empty', () => {
        expect(parseMounts(['mount:bucket/:ro'])).toEqual([
            Mount.fromPartial({
                name: 'mount',
                mode: Mount_Mode.READ_ONLY,
                objectStorage: { bucketId: 'bucket', prefix: '' }
            })
        ])
    })
})
