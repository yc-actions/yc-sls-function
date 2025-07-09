import { expect, test } from '@jest/globals'
import { parseLockboxVariables, Secret } from '../src/parse'

describe('secrets', () => {
    test('it should return right lockbox secrets', () => {
        const input = ['ENV_VAR_1=id/verId/VAR_1', 'ENV_VAR_2=id/verId/VAR_2']
        const result = parseLockboxVariables(input)
        const expected: Secret[] = [
            {
                environmentVariable: 'ENV_VAR_1',
                id: 'id',
                versionId: 'verId',
                key: 'VAR_1'
            },
            {
                environmentVariable: 'ENV_VAR_2',
                id: 'id',
                versionId: 'verId',
                key: 'VAR_2'
            }
        ]
        expect(result).toEqual(expected)
    })

    test.each(['123412343', '123=id', '123=id/verId', '123=id/verId/'])(
        'it should throw error when bad input provided %s',
        input => {
            expect(() => parseLockboxVariables([input])).toThrow()
        }
    )
})
