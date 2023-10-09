import {cloudApi} from '@yandex-cloud/nodejs-sdk';

export const {
  logging: {
    log_entry: {LogLevel_Level},
  },
} = cloudApi;

export const parseLogLevel = (levelKey: string): cloudApi.logging.log_entry.LogLevel_Level => {
  if (levelKey === '') {
    return LogLevel_Level.LEVEL_UNSPECIFIED;
  }
  if (!Object.keys(LogLevel_Level).includes(levelKey.toUpperCase())) {
    throw new Error('Log level has unknown value');
  }
  return LogLevel_Level[levelKey.toUpperCase() as keyof typeof LogLevel_Level];
};
