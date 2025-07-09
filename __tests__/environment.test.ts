import { expect, test } from '@jest/globals'
import { parseEnvironmentVariables, parseLockboxVariables } from '../src/parse'

describe('environment', () => {
    test('it should return right lockbox secrets', () => {
        const input = [
            'KEY1=value1',
            'BASE64_KEY1=YmFzZTY0X2VuY29kZWRfd2l0aF9lcXVhbF9zaWduXzE=',
            'BASE64_KEY2=YmFzZTY0X2VuY29kZWRfd2l0aF9lcXVhbF9zaWduXzI==',
            'BASE64_KEY3=YmFzZTY0X2VuY29kZWRfd2l0aF9taWRkbGVfc2lnbl9lcXVhbD1yZXF1aXJlZA==',
            'JUST_KEY_SHOULD_BE_A_KEY=zZTY0X2VuY29kZWRf'
        ]

        const result = parseEnvironmentVariables(input)

        const expected: Record<string, string> = {
            KEY1: 'value1',
            BASE64_KEY1: 'YmFzZTY0X2VuY29kZWRfd2l0aF9lcXVhbF9zaWduXzE=',
            BASE64_KEY2: 'YmFzZTY0X2VuY29kZWRfd2l0aF9lcXVhbF9zaWduXzI==',
            BASE64_KEY3: 'YmFzZTY0X2VuY29kZWRfd2l0aF9taWRkbGVfc2lnbl9lcXVhbD1yZXF1aXJlZA==',
            JUST_KEY_SHOULD_BE_A_KEY: 'zZTY0X2VuY29kZWRf'
        }

        expect(result).toEqual(expected)
    })

    test.each(['123412343', '123=id', '123=id/verId', '123=id/verId/'])(
        'it should throw error when bad input provided %s',
        input => {
            expect(() => parseLockboxVariables([input])).toThrow()
        }
    )
})
