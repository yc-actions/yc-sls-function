import {expect, test} from '@jest/globals';
import {getInput} from '@actions/core';
import {cloudApi} from '@yandex-cloud/nodejs-sdk';
import {parseLogLevel} from '../src/log-level';

const levelsArray = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const LEVELS = cloudApi.logging.log_entry.LogLevel_Level;

test('should return default value LEVEL_UNSPECIFIED when key is not set', () => {
  expect(parseLogLevel(getInput('log_level', {required: false, trimWhitespace: true}))).toEqual(LEVELS.LEVEL_UNSPECIFIED)
})

test.each(levelsArray)('should return correct enum for LogLevel = %s', (level: string) => {
  process.env.INPUT_LOG_LEVEL = level;
  const result = parseLogLevel(getInput('log_level', {required: false, trimWhitespace: true}));
  expect(result).toEqual(LEVELS[level as keyof typeof LEVELS]);
});

test('should throw an error if value is invalid', () => {
  try {
    parseLogLevel('invalidKey');
  } catch (e: any) {
    expect(e.message).toEqual('Log level has unknown value');
  }
});
