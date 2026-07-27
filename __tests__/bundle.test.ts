/**
 * Smoke test for the built bundle.
 *
 * Unit tests mock the SDK, so they cannot catch a bundle that fails to load.
 * This runs dist/index.js in a subprocess with no credentials and asserts it
 * reaches the action's own validation rather than a module-resolution error.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

describe('dist/index.js', () => {
    it('loads and fails with No credentials', async () => {
        if (!existsSync('dist/index.js')) {
            throw new Error('dist/index.js is missing - run `npm run package` first')
        }

        // writeSummary() runs in main's finally block and needs this file.
        const dir = mkdtempSync(path.join(tmpdir(), 'yc-sls-smoke-'))
        const summaryFile = path.join(dir, 'summary.md')
        writeFileSync(summaryFile, '')

        let stdout = ''
        let code: number | undefined
        try {
            const result = await execFileAsync(process.execPath, ['dist/index.js'], {
                env: {
                    ...process.env,
                    GITHUB_STEP_SUMMARY: summaryFile,
                    GITHUB_SHA: 'sha',
                    GITHUB_REPOSITORY: 'owner/repo'
                }
            })
            stdout = result.stdout
            code = 0
        } catch (err) {
            const e = err as { code?: number; stdout?: string; stderr?: string }
            stdout = `${e.stdout ?? ''}${e.stderr ?? ''}`
            code = e.code
        }

        expect(stdout).toContain('No credentials')
        expect(stdout).not.toContain('Cannot find module')
        expect(stdout).not.toContain('is not defined')
        expect(code).toBe(1)
    }, 60000)
})
