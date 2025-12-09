/**
 * Parser for cloud logging level specifications.
 *
 * Converts log level strings to Yandex Cloud LogLevel enum values.
 *
 * @module
 */

import { LogLevel_Level } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/logging/v1/log_entry'

const LOG_LEVEL_VALUES = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']

/**
 * Parses log level string to enum value.
 *
 * @param levelKey - Log level string (case-insensitive) or empty for unspecified
 * @returns LogLevel_Level enum value
 * @throws {Error} If level is not recognized
 *
 * @example
 * parseLogLevel('INFO')   // Returns LogLevel_Level.INFO
 * parseLogLevel('')       // Returns LogLevel_Level.LEVEL_UNSPECIFIED
 * parseLogLevel('debug')  // Returns LogLevel_Level.DEBUG (case-insensitive)
 */
export const parseLogLevel = (levelKey: string): LogLevel_Level => {
    if (levelKey === '') {
        return LogLevel_Level.LEVEL_UNSPECIFIED
    }
    if (!LOG_LEVEL_VALUES.includes(levelKey.toUpperCase())) {
        throw new Error('Log level has unknown value')
    }
    return LogLevel_Level[levelKey.toUpperCase() as keyof typeof LogLevel_Level]
}
