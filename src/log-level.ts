import { cloudApi } from '@yandex-cloud/nodejs-sdk'

export const {
    logging: {
        log_entry: { LogLevel_Level }
    }
} = cloudApi

const LOG_LEVEL_VALUES = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']

export const parseLogLevel = (levelKey: string): cloudApi.logging.log_entry.LogLevel_Level => {
    if (levelKey === '') {
        return LogLevel_Level.LEVEL_UNSPECIFIED
    }
    if (!LOG_LEVEL_VALUES.includes(levelKey.toUpperCase())) {
        throw new Error('Log level has unknown value')
    }
    return LogLevel_Level[levelKey.toUpperCase() as keyof typeof LogLevel_Level]
}
