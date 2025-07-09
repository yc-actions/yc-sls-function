import { expect, test } from '@jest/globals'
import { GB, MB, parseMemory } from '../src/parse'

const mbs = ['mb', 'MB', ' mb']
const gbs = ['GB', 'Gb', ' gb']

test.each(
    [128, 256, 512, 1024, 2048].flatMap(x =>
        mbs.map(u => ({
            input: x.toString() + u,
            expected: x * MB
        }))
    )
)('memory value $input', ({ input, expected }) => {
    expect(parseMemory(input)).toEqual(expected)
})

test.each(
    [1, 2, 4, 8].flatMap(x =>
        gbs.map(u => ({
            input: x.toString() + u,
            expected: x * GB
        }))
    )
)('memory value $input', ({ input, expected }) => {
    expect(parseMemory(input)).toEqual(expected)
})
