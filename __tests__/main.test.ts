import { expect, test } from '@jest/globals'
import { parseEnvironmentVariables, parseLockboxVariables, Secret, ZipInputs, zipSources } from '../src/main'
import archiver from 'archiver'

// shows how the runner will run a javascript action with env / stdout protocol
describe('zipSources', function () {
    test('it should add files from include', async () => {
        const archive = archiver('zip', { zlib: { level: 9 } })
        const inputs: ZipInputs = {
            include: ['./src'],
            excludePattern: [],
            sourceRoot: '.'
        }

        const entries: archiver.EntryData[] = []
        archive.on('entry', e => entries.push(e))
        await zipSources(inputs, archive)

        const allStartWithSrc = entries.every(e => e.name.includes('src'))
        expect(allStartWithSrc).toBeTruthy()
    })

    test('it should drop files from if they do not match include patterns', async () => {
        const archive = archiver('zip', { zlib: { level: 9 } })
        const inputs: ZipInputs = {
            include: ['./src/*.js'],
            excludePattern: [],
            sourceRoot: '.'
        }

        const entries: archiver.EntryData[] = []
        archive.on('entry', e => entries.push(e))
        await zipSources(inputs, archive)

        const allStartWithSrc = entries.every(e => e.name.includes('src'))
        expect(allStartWithSrc).toBeTruthy()
        expect(entries.length).toBe(1)
        expect(entries[0].name).toBe('src/func.js')
    })

    test('it should drop files from if they match exclude patterns', async () => {
        const archive = archiver('zip', { zlib: { level: 9 } })
        const inputs: ZipInputs = {
            include: ['./src'],
            excludePattern: ['*.txt'],
            sourceRoot: '.'
        }

        const entries: archiver.EntryData[] = []
        archive.on('entry', e => entries.push(e))
        await zipSources(inputs, archive)

        const allStartWithSrc = entries.every(e => e.name.includes('src'))
        expect(allStartWithSrc).toBeTruthy()
        expect(entries.length).toBe(8)
    })

    test('it should drop folder prefix if sourceRoot provided', async () => {
        const archive = archiver('zip', { zlib: { level: 9 } })
        const inputs: ZipInputs = {
            include: ['.'],
            excludePattern: [],
            sourceRoot: './src'
        }

        const entries: archiver.EntryData[] = []
        archive.on('entry', e => entries.push(e))
        await zipSources(inputs, archive)

        const noneStartWithSrc = entries.every(e => !e.name.includes('src'))

        expect(noneStartWithSrc).toBeTruthy()
        expect(entries.length).toEqual(9)
    })

    test.each([['./src'], ['./src/'], ['src']])(
        'it should respect source root and include only needed files with root %s',
        async sourceRoot => {
            const archive = archiver('zip', { zlib: { level: 9 } })
            const inputs: ZipInputs = {
                include: ['./*.js', 'foo/1.txt'],
                excludePattern: [],
                sourceRoot
            }

            const entries: archiver.EntryData[] = []
            archive.on('entry', e => entries.push(e))
            await zipSources(inputs, archive)

            const noneStartWithSrc = entries.every(e => !e.name.includes('src'))
            expect(noneStartWithSrc).toBeTruthy()
            expect(entries.length).toBe(2)
            entries.sort((a, b) => a.name.localeCompare(b.name))
            expect(entries[0].name).toBe('foo/1.txt')
            expect(entries[1].name).toBe('func.js')
        }
    )

    test('it should add folders', async () => {
        const archive = archiver('zip', { zlib: { level: 9 } })
        const inputs: ZipInputs = {
            include: ['./src/foo', './src/bar/*'],
            excludePattern: [],
            sourceRoot: '.'
        }

        const entries: archiver.EntryData[] = []
        archive.on('entry', e => entries.push(e))
        await zipSources(inputs, archive)

        const allStartWithSrc = entries.every(e => e.name.includes('src'))
        expect(allStartWithSrc).toBeTruthy()
        expect(entries.length).toBe(4)
        expect(entries.map(x => x.name).sort()).toMatchSnapshot()
    })

    test('it should ignore empty lines in include', async () => {
        const archive = archiver('zip', { zlib: { level: 9 } })
        const inputs: ZipInputs = {
            include: ['func.js', 'foo/1.txt', ''],
            excludePattern: [],
            sourceRoot: './src/'
        }

        const entries: archiver.EntryData[] = []
        archive.on('entry', e => entries.push(e))
        await zipSources(inputs, archive)

        const noneStartWithSrc = entries.every(e => !e.name.includes('src'))
        expect(noneStartWithSrc).toBeTruthy()
        expect(entries.length).toEqual(2)
        expect(entries.map(x => x.name).sort()).toMatchSnapshot()
    })
})

describe('lockbox', () => {
    test('it should return right lockbox secrets', () => {
        const input = ['ENV_VAR_1=id/verId/VAR_1', 'ENV_VAR_2=id/verId/VAR_2']
        const result = parseLockboxVariables(input)
        const expected: Secret[] = [
            {
                environmentVariable: 'ENV_VAR_1',
                id: 'id',
                versionId: 'verId',
                key: 'VAR_1'
            },
            {
                environmentVariable: 'ENV_VAR_2',
                id: 'id',
                versionId: 'verId',
                key: 'VAR_2'
            }
        ]
        expect(result).toEqual(expected)
    })

    test.each(['123412343', '123=id', '123=id/verId', '123=id/verId/'])(
        'it should throw error when bad input provided %s',
        input => {
            expect(() => parseLockboxVariables([input])).toThrow()
        }
    )
})

describe('environment', () => {
    test('it should return right lockbox secrets', () => {
        const input = [
            'KEY1=value1',
            'BASE64_KEY1=YmFzZTY0X2VuY29kZWRfd2l0aF9lcXVhbF9zaWduXzE=',
            'BASE64_KEY2=YmFzZTY0X2VuY29kZWRfd2l0aF9lcXVhbF9zaWduXzI==',
            'BASE64_KEY3=YmFzZTY0X2VuY29kZWRfd2l0aF9taWRkbGVfc2lnbl9lcXVhbD1yZXF1aXJlZA==',
            'JUST_KEY_SHOULD_BE_A_KEY=zZTY0X2VuY29kZWRf'
        ]

        const result = parseEnvironmentVariables(input)

        const expected: Record<string, string> = {
            KEY1: 'value1',
            BASE64_KEY1: 'YmFzZTY0X2VuY29kZWRfd2l0aF9lcXVhbF9zaWduXzE=',
            BASE64_KEY2: 'YmFzZTY0X2VuY29kZWRfd2l0aF9lcXVhbF9zaWduXzI==',
            BASE64_KEY3: 'YmFzZTY0X2VuY29kZWRfd2l0aF9taWRkbGVfc2lnbl9lcXVhbD1yZXF1aXJlZA==',
            JUST_KEY_SHOULD_BE_A_KEY: 'zZTY0X2VuY29kZWRf'
        }
        
        expect(result).toEqual(expected)
    })

    test.each(['123412343', '123=id', '123=id/verId', '123=id/verId/'])(
        'it should throw error when bad input provided %s',
        input => {
            expect(() => parseLockboxVariables([input])).toThrow()
        }
    )
})
