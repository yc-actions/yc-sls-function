import archiver from 'archiver'
import { debug, endGroup, info, startGroup } from '@actions/core'
import { WritableStreamBuffer } from 'stream-buffers'
import { KB, parseIgnoreGlobPatterns } from './parse'
import path from 'node:path'
import { glob } from 'glob'
import { lstatSync } from 'node:fs'
import { minimatch } from 'minimatch'

export interface ZipInputs {
    include: string[]
    excludePattern: string[]
    sourceRoot: string
}

export async function zipSources(inputs: ZipInputs, archive: archiver.Archiver): Promise<Buffer> {
    startGroup('ZipDirectory')

    try {
        const outputStreamBuffer = new WritableStreamBuffer({
            initialSize: 1000 * KB, // start at 1000 kilobytes.
            incrementAmount: 1000 * KB // grow by 1000 kilobytes each time buffer overflows.
        })

        info('Archive initialize')

        archive.on('entry', e => {
            info(`add: ${e.name}`)
        })

        const workspace = process.env['GITHUB_WORKSPACE'] ?? ''
        archive.pipe(outputStreamBuffer)
        const patterns = parseIgnoreGlobPatterns(inputs.excludePattern)
        const root = path.join(workspace, inputs.sourceRoot)
        const includes = inputs.include.filter(x => x.length > 0)
        for (const include of includes) {
            const pathFromSourceRoot = path.join(root, include)
            const matches = glob.sync(pathFromSourceRoot, { absolute: false })
            for (const match of matches) {
                if (lstatSync(match).isDirectory()) {
                    debug(`match:  dir ${match}`)
                    archive.directory(pathFromSourceRoot, include, data => {
                        const res = !patterns.map(p => minimatch(data.name, p)).some(x => x)
                        return res ? data : false
                    })
                } else {
                    debug(`match: file ${match}`)
                    archive.file(match, { name: path.relative(root, match) })
                }
            }
        }

        await archive.finalize()

        info('Archive finalized')

        outputStreamBuffer.end()
        const buffer = outputStreamBuffer.getContents()
        info('Buffer object created')

        if (!buffer) {
            throw Error('Failed to initialize Buffer')
        }

        return buffer
    } finally {
        endGroup()
    }
}
