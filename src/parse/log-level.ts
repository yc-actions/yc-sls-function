import { LogLevel_Level } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/logging/v1/log_entry'

const LOG_LEVEL_VALUES = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']

export const parseLogLevel = (levelKey: string): LogLevel_Level => {
    if (levelKey === '') {
        return LogLevel_Level.LEVEL_UNSPECIFIED
    }
    if (!LOG_LEVEL_VALUES.includes(levelKey.toUpperCase())) {
        throw new Error('Log level has unknown value')
    }
    return LogLevel_Level[levelKey.toUpperCase() as keyof typeof LogLevel_Level]
}
