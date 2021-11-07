import {test, expect} from '@jest/globals';
import {GB, MB, parseMemory} from '../src/memory';

const mbs = ['mb', 'MB', ' mb'];
const gbs = ['GB', 'Gb', ' gb'];

test.each(
  [128, 256, 512, 1024, 2048].flatMap(x =>
    mbs.map(u => ({
      input: x.toString() + u,
      expected: (x as any) * MB,
    })),
  ),
)('test memory value $input', ({input, expected}) => {
  expect(parseMemory(input)).toEqual(expected);
});

test.each(
  [1, 2, 4, 8].flatMap(x =>
    gbs.map(u => ({
      input: x.toString() + u,
      expected: (x as any) * GB,
    })),
  ),
)('test memory value $input', ({input, expected}) => {
  expect(parseMemory(input)).toEqual(expected);
});
