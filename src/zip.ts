/**
 * Source code archiving utilities.
 *
 * Creates zip archives from source files using glob patterns and exclusion rules.
 *
 * @module
 */

import archiver from 'archiver'
import { debug, endGroup, info, startGroup } from '@actions/core'
import { WritableStreamBuffer } from 'stream-buffers'
import { KB, parseIgnoreGlobPatterns } from './parse'
import path from 'node:path'
import { glob } from 'glob'
import { lstatSync } from 'node:fs'
import { minimatch } from 'minimatch'

/**
 * Configuration for source code archiving.
 */
export interface ZipInputs {
    /** Glob patterns for files to include */
    include: string[]

    /** Glob patterns to exclude (e.g., 'node_modules/**', '*.test.ts') */
    excludePattern: string[]

    /** Root directory for source resolution (relative to GITHUB_WORKSPACE) */
    sourceRoot: string
}

/**
 * Creates zip archive of source files for function deployment.
 *
 * Process:
 * 1. Resolves include patterns to files/directories
 * 2. Applies exclusion patterns to filter files
 * 3. Creates zip archive in memory buffer
 * 4. Logs each added file for debugging
 *
 * @param inputs - Zip configuration with include/exclude patterns
 * @param archive - archiver instance (configured externally)
 * @returns Buffer containing zip archive
 * @throws {Error} If archive creation fails or buffer initialization fails
 *
 * @example
 * const archive = archiver('zip', { zlib: { level: 9 } })
 * const buffer = await zipSources({
 *   include: ['**\/*.js', '**\/*.json'],
 *   excludePattern: ['node_modules/**', '*.test.js'],
 *   sourceRoot: 'src'
 * }, archive)
 *
 * @remarks
 * Initial buffer size: 1MB, grows by 1MB increments.
 * Archives relative paths from sourceRoot.
 */
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
