import { expect, test } from '@jest/globals'
import archiver from 'archiver'
import { ZipInputs, zipSources } from '../src/zip'

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
