/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

module.exports = {
    moduleFileExtensions: ['js', 'ts', 'json'],
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: './__tests__/tsconfig.json'
            }
        ]
    },
    transformIgnorePatterns: [],
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.[jt]s?(x)']
}
