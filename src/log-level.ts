const LOG_LEVEL_KEYS = ['unspecified', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type LOG_LEVEL = (typeof LOG_LEVEL_KEYS)[number];

const logLevelValues: Record<LOG_LEVEL, number> = {
  unspecified: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

export const parseLogLevel = (levelKey: LOG_LEVEL): number => {
  if (levelKey === undefined) {
    return 0;
  }
  if (!LOG_LEVEL_KEYS.includes(levelKey)) {
    throw new Error('Log level has unknown value');
  }
  return logLevelValues[levelKey];
};
