// See: https://eslint.org/docs/latest/use/configure/configuration-files

import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import jest from 'eslint-plugin-jest'
import prettier from 'eslint-plugin-prettier'
import globals from 'globals'

const compat = new FlatCompat({
    baseDirectory: import.meta.dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
})

export default [
    {
        // SCAFFOLDING - Task 2 only, mirrors jest.config.js's testPathIgnorePatterns.
        // '__fixtures__/workspace/src/func.js' is zip test data with no tsconfig
        // coverage; it stays ignored until it has a project of its own.
        // '__tests__/main.test.ts' and '__tests__/characterization.test.ts' fail
        // lint today only because of the pre-ESM manual __mocks__ imports
        // (jest/no-mocks-import) and the stale import/no-namespace disable comment
        // (see Step 3); Task 4 rewrites both files and must remove these two
        // entries once they lint clean on their own.
        ignores: [
            '**/coverage',
            '**/dist',
            '**/node_modules',
            '__fixtures__/workspace/src/func.js',
            '__tests__/main.test.ts',
            '__tests__/characterization.test.ts'
        ]
    },
    ...compat.extends(
        'eslint:recommended',
        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:jest/recommended',
        'plugin:prettier/recommended'
    ),
    {
        plugins: {
            jest,
            prettier,
            '@typescript-eslint': typescriptEslint
        },

        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest
            },

            parser: tsParser,
            ecmaVersion: 2023,
            sourceType: 'module',

            parserOptions: {
                projectService: {
                    // __fixtures__ is nested (__fixtures__/yandex-sdk/*.ts) and
                    // __tests__/__mocks__ goes several levels deep, so a
                    // single-level glob like the template's is not enough. The
                    // installed @typescript-eslint/typescript-estree (8.65.0)
                    // hard-rejects any glob containing '**' (see
                    // https://tseslint.io/rules/allowdefaultproject-glob-too-wide),
                    // so each depth is spelled out explicitly instead.
                    allowDefaultProject: [
                        '__fixtures__/*.ts',
                        '__fixtures__/*/*.ts',
                        '__tests__/*.ts',
                        '__tests__/__mocks__/*/*.ts',
                        '__tests__/__mocks__/*/*/*.ts',
                        '__tests__/__mocks__/*/*/*/*.ts',
                        'eslint.config.mjs',
                        'jest.config.js',
                        'rollup.config.ts'
                    ],
                    // The repo has ~20 files outside tsconfig's `include: ["src"]`
                    // (test files, SDK mocks, fixtures, config files) — comfortably
                    // over the default cap of 8. This is a small action repo, not
                    // the large monorepo the default guards against.
                    maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 50
                },
                tsconfigRootDir: import.meta.dirname
            }
        },

        rules: {
            camelcase: 'off',
            'no-console': 'off',
            'no-shadow': 'off',
            'no-unused-vars': 'off',
            'prettier/prettier': 'error'
        }
    }
]
