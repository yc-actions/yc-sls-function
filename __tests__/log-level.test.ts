import { expect, test } from '@jest/globals'
import { getInput } from '@actions/core'
import { parseLogLevel } from '../src/log-level'
import { LogLevel_Level } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/logging/v1/log_entry'

const levelsArray = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
const LEVELS = LogLevel_Level

test('should return default value LEVEL_UNSPECIFIED when key is not set', () => {
    expect(parseLogLevel(getInput('log_level', { required: false, trimWhitespace: true }))).toEqual(
        LEVELS.LEVEL_UNSPECIFIED
    )
})

test.each(levelsArray)('should return correct enum for LogLevel = %s', (level: string) => {
    process.env.INPUT_LOG_LEVEL = level
    const result = parseLogLevel(getInput('log_level', { required: false, trimWhitespace: true }))
    expect(result).toEqual(LEVELS[level as keyof typeof LEVELS])
})

test('should throw an error if value is invalid', () => {
    try {
        parseLogLevel('invalidKey')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
        expect(e.message).toEqual('Log level has unknown value')
    }
})
