# typescript-action Template Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `yc-actions/yc-sls-function` onto the `actions/typescript-action` code organization and development harness without changing what the action does.

**Architecture:** True ESM source bundled to `dist/index.js` by Rollup. `src/main.ts` becomes thin orchestration with four business functions extracted into focused modules. Tests move to the template's `__fixtures__` + `jest.unstable_mockModule` pattern. A characterization snapshot captured on `main` *before* any change is the regression net for the whole rewrite.

**Tech Stack:** TypeScript 5.9 (NodeNext), Rollup 4, Jest 30 + ts-jest (ESM), ESLint 9 flat config, Prettier 3, `@yandex-cloud/nodejs-sdk` 3.2, Node 24.

**Spec:** `docs/superpowers/specs/2026-07-27-typescript-action-template-rewrite-design.md`

## Global Constraints

- Node floor: `engines.node >= 24.0.0`, `.node-version` = `24.4.0`, `action.yml` `using: node24`.
- Prettier values are **this repo's**, not the template's: `printWidth: 120`, `tabWidth: 4`, `useTabs: false`, `semi: false`, `singleQuote: true`, `quoteProps: as-needed`, `trailingComma: none`, `bracketSpacing: true`, `bracketSameLine: true`, `arrowParens: avoid`, `proseWrap: always`, `htmlWhitespaceSensitivity: css`, `endOfLine: lf`. In the template's `.prettierrc.yml` file format.
- Every **relative** import ends in `.js`. Directory imports become explicit: `./parse` → `./parse/index.js`. Bare specifiers and `@yandex-cloud/nodejs-sdk/...` deep specifiers are **not** changed — the SDK's `exports` map contains `"./dist/*": "./dist/*.js"`, so they already resolve under NodeNext.
- Coverage floors (from pre-rewrite measurement): lines 50, statements 50, functions 45, branches 42. If a metric drops below a floor, add the missing test — do not lower the floor.
- `action.yml` inputs and outputs are unchanged except the `using:` runtime.
- Business behavior must not change. `__tests__/__snapshots__/characterization.test.ts.snap` from Task 1 is the contract; it is never regenerated after Task 1.
- Never run bare `npx jest -u` after Task 1. Snapshot-verifying runs use `--ci` so an unexpected snapshot fails instead of being silently written.

---

### Task 1: Characterization snapshot on `main`

Capture the exact SDK requests the current code produces, before anything moves. This runs on the **current** toolchain (`jest.mock`, CommonJS-ish config) and is committed to `main`.

`__fixtures__/normalize-request.ts` is written now, in its final location, with zero jest and zero SDK imports — it survives the harness swap untouched.

**Note on the S3 upload:** the spec called for recording `putObject` arguments. They are fully determined by the recorded `CreateFunctionVersionRequest.package` field (`bucketName`, `objectName`, `sha256`), so recording them separately would mean modifying `src/storage/__mocks__/index.ts`, which Task 4 deletes. Recording `package` instead covers the same contract and keeps the pre- and post-rewrite test code aligned.

**Files:**
- Create: `__fixtures__/normalize-request.ts`
- Create: `__tests__/characterization.test.ts`
- Create (generated): `__tests__/__snapshots__/characterization.test.ts.snap`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalize(value: unknown): unknown` from `__fixtures__/normalize-request.ts`. Used by Task 4's ported characterization test.

- [ ] **Step 1: Write the normalizer**

Create `__fixtures__/normalize-request.ts`:

```ts
/**
 * Stable serializer for recorded Yandex Cloud SDK request objects.
 *
 * Deliberately free of jest and SDK imports so it survives the migration from
 * `jest.mock` to `jest.unstable_mockModule` unchanged.
 */

/**
 * Keys whose values are not reproducible across runs and are replaced with a
 * fixed marker.
 *
 * `sha256` digests the zip archive, and archiver embeds file mtimes, so the
 * digest differs between checkouts. Zip *contents* are characterized by
 * `zip-sources.test.ts` instead.
 */
const REDACTED_KEYS = new Set(['sha256'])

/**
 * Normalizes a value into a form that is stable across runs and machines.
 *
 * - Buffers and byte arrays become `bytes:<length>` — the length is stable for
 *   a fixed file set even though the bytes are not.
 * - protobufjs `Long` instances become their decimal string.
 * - Dates become `date:<iso>`.
 * - Object keys are sorted so key insertion order cannot cause a false diff.
 */
export function normalize(value: unknown): unknown {
    if (value === null || value === undefined) {
        return value
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return `bytes:${value.length}`
    }
    if (typeof value === 'bigint') {
        return value.toString()
    }
    if (value instanceof Date) {
        return `date:${value.toISOString()}`
    }
    if (Array.isArray(value)) {
        return value.map(normalize)
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>
        // protobufjs Long: has low/high/unsigned and a decimal toString().
        if ('low' in obj && 'high' in obj && 'unsigned' in obj) {
            return String(obj)
        }
        const out: Record<string, unknown> = {}
        for (const key of Object.keys(obj).sort()) {
            out[key] = REDACTED_KEYS.has(key) ? '<redacted>' : normalize(obj[key])
        }
        return out
    }
    return value
}
```

- [ ] **Step 2: Write the characterization test**

Create `__tests__/characterization.test.ts`:

```ts
/**
 * Behavior contract for the deploy logic.
 *
 * Records every Yandex Cloud SDK request the action issues, per input scenario,
 * and snapshots it. The snapshot is captured on the pre-rewrite code and must be
 * reproduced byte-identically by the rewritten code.
 */
// eslint-disable-next-line import/no-namespace
import * as core from '@actions/core'
import { context } from '@actions/github'
import axios from 'axios'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'
import { Version_Status } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'

import { run } from '../src/main'
import { normalize } from '../__fixtures__/normalize-request'
import { __setServiceAccountList, ServiceAccountServiceMock } from './__mocks__/@yandex-cloud/nodejs-sdk/iam-v1'
import {
    __setCreateFunctionFail,
    __setCreateVersionFail,
    __setFunctionList,
    __setVersionList,
    FunctionServiceMock
} from './__mocks__/@yandex-cloud/nodejs-sdk/serverless-functions-v1'
import { __setLockboxVersions } from './__mocks__/@yandex-cloud/nodejs-sdk/lockbox-v1'

jest.mock('../src/storage')

const SA_JSON = `{
    "id": "id",
    "created_at": "2021-01-01T00:00:00Z",
    "key_algorithm": "RSA_2048",
    "service_account_id": "service_account_id",
    "private_key": "private_key",
    "public_key": "public_key"
  }`

const REQUIRED: Record<string, string> = {
    'folder-id': 'folderid',
    'function-name': 'my-function',
    runtime: 'nodejs16',
    entrypoint: 'index.handler',
    'logs-disabled': 'false',
    async: 'false'
}

const SCENARIOS: { name: string; inputs: Record<string, string>; setup?: () => void }[] = [
    {
        name: 'required inputs only, inline upload, SA JSON credentials',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON }
    },
    {
        name: 'bucket upload',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON, bucket: 'some-bucket' }
    },
    {
        name: 'IAM token credentials',
        inputs: { ...REQUIRED, 'yc-iam-token': 'iam-token-input' }
    },
    {
        name: 'workload identity federation credentials',
        inputs: { ...REQUIRED, 'yc-sa-id': 'wif-sa-id' }
    },
    {
        name: 'environment, tags, network, description, timeout, memory',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            memory: '256Mb',
            'execution-timeout': '30',
            environment: 'FOO=BAR\nFOO2=BAR2',
            description: 'some description',
            'network-id': 'networkid',
            tags: 'tag1\ntag2',
            'service-account': 'serviceaccountid'
        }
    },
    {
        name: 'service account resolved by name',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON, 'service-account-name': 'service-account-name' },
        setup: () =>
            __setServiceAccountList([
                ServiceAccount.fromJSON({ id: 'serviceaccountid', name: 'service-account-name' })
            ])
    },
    {
        name: 'log options',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            'logs-disabled': 'true',
            'logs-group-id': 'logsgroupid',
            'log-level': 'WARN'
        }
    },
    {
        name: 'mounts',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            mounts: 'data:my-bucket\nimages:my-bucket/photos:ro'
        }
    },
    {
        name: 'secrets with explicit version',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON, secrets: 'ENV_VAR_1=secret-id/verid/VAR_1' }
    },
    {
        name: 'secrets with latest version resolved',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON, secrets: 'ENV_VAR_1=secret-id/latest/VAR_1' },
        setup: () =>
            __setLockboxVersions([
                {
                    id: 'v1',
                    createdAt: new Date('2023-01-01T00:00:00Z'),
                    secretId: '',
                    description: '',
                    status: Version_Status.STATUS_UNSPECIFIED,
                    payloadEntryKeys: []
                },
                {
                    id: 'v2',
                    createdAt: new Date('2024-01-01T00:00:00Z'),
                    secretId: '',
                    description: '',
                    status: Version_Status.ACTIVE,
                    payloadEntryKeys: []
                }
            ])
    },
    {
        name: 'async with both ymq targets',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            async: 'true',
            'async-sa-id': 'async-sa-id',
            'async-retries-count': '3',
            'async-success-ymq-arn': 'arn:aws:sqs:us-east-1:123456789012:queue-name',
            'async-success-sa-id': 'success-sa-id',
            'async-failure-ymq-arn': 'arn:aws:sqs:us-east-1:123456789012:queue-name',
            'async-failure-sa-id': 'failure-sa-id'
        }
    },
    {
        name: 'async with empty targets falling back to function service account',
        inputs: {
            ...REQUIRED,
            'yc-sa-json-credentials': SA_JSON,
            async: 'true',
            'service-account': 'serviceaccountid'
        }
    },
    {
        name: 'function already exists',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON },
        setup: () =>
            __setFunctionList([
                (
                    jest.requireActual(
                        '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
                    ) as typeof import('@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function')
                ).Function.fromJSON({
                    id: 'functionid',
                    name: 'my-function',
                    folder_id: 'folderid',
                    status: 'ACTIVE'
                })
            ])
    },
    {
        name: 'function creation fails',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON },
        setup: () => __setCreateFunctionFail(true)
    },
    {
        name: 'version creation fails',
        inputs: { ...REQUIRED, 'yc-sa-json-credentials': SA_JSON },
        setup: () => __setCreateVersionFail(true)
    }
]

describe('characterization', () => {
    let tmpSummaryFile: string

    beforeEach(() => {
        tmpSummaryFile = path.join(os.tmpdir(), `gh-summary-characterization`)
        process.env.GITHUB_STEP_SUMMARY = tmpSummaryFile
        fs.writeFileSync(tmpSummaryFile, '', { flag: 'w' })
        process.env.GITHUB_REPOSITORY = 'owner/repo'
        process.env.GITHUB_SHA = 'sha'

        jest.clearAllMocks()
        jest.spyOn(core, 'error').mockImplementation()
        jest.spyOn(core, 'setFailed').mockImplementation()
        jest.spyOn(core, 'setOutput').mockImplementation()
        jest.spyOn(core, 'getIDToken').mockImplementation(async () => 'github-token')
        jest.spyOn(axios, 'post').mockImplementation(async () => ({
            status: 200,
            data: { access_token: 'iam-token' }
        }))
        jest.spyOn(context, 'repo', 'get').mockImplementation(() => ({
            owner: 'some-owner',
            repo: 'some-repo'
        }))

        __setServiceAccountList([ServiceAccount.fromJSON({ id: 'serviceaccountid' })])
        __setFunctionList([])
        __setVersionList([])
        __setLockboxVersions([])
        __setCreateFunctionFail(false)
        __setCreateVersionFail(false)
    })

    afterEach(() => {
        jest.restoreAllMocks()
        if (tmpSummaryFile && fs.existsSync(tmpSummaryFile)) {
            fs.unlinkSync(tmpSummaryFile)
        }
        delete process.env.GITHUB_STEP_SUMMARY
    })

    for (const scenario of SCENARIOS) {
        it(`records SDK requests: ${scenario.name}`, async () => {
            jest.spyOn(core, 'getInput').mockImplementation((name: string) => scenario.inputs[name] || '')
            jest.spyOn(core, 'getBooleanInput').mockImplementation((name: string) => scenario.inputs[name] === 'true')
            jest.spyOn(core, 'getMultilineInput').mockImplementation((name: string) =>
                scenario.inputs[name] ? scenario.inputs[name].split('\n') : []
            )
            scenario.setup?.()

            await run()

            expect({
                listFunctions: normalize(FunctionServiceMock.list.mock.calls),
                createFunction: normalize(FunctionServiceMock.create.mock.calls),
                createVersion: normalize(FunctionServiceMock.createVersion.mock.calls),
                listServiceAccounts: normalize(ServiceAccountServiceMock.list.mock.calls)
            }).toMatchSnapshot()
        })
    }
})
```

- [ ] **Step 3: Run the test to generate the snapshot**

```bash
npm test -- __tests__/characterization.test.ts
```

Expected: PASS, and `__tests__/__snapshots__/characterization.test.ts.snap` is written with 15 entries. If any scenario errors instead of recording, fix the scenario setup — do **not** delete the scenario.

- [ ] **Step 4: Verify the snapshot is stable across runs**

```bash
npm test -- __tests__/characterization.test.ts --ci
```

Expected: PASS with no snapshots written. `--ci` fails on any new or changed snapshot, which proves the normalizer removed every source of run-to-run variance. If this fails, find the varying field and add its key to `REDACTED_KEYS`.

- [ ] **Step 5: Confirm the existing suite still passes**

```bash
npm test
```

Expected: PASS. Task 1 adds files only; nothing existing changed.

- [ ] **Step 6: Commit**

```bash
git add __fixtures__/normalize-request.ts __tests__/characterization.test.ts __tests__/__snapshots__/characterization.test.ts.snap
git commit -m "test: characterize SDK request payloads before template rewrite

Records every Yandex Cloud SDK request the action issues across 15 input
scenarios and snapshots the normalized result. This snapshot is the
behavior contract the template rewrite must reproduce byte-identically,
since the tests that currently protect this logic are themselves being
rewritten."
```

---

### Task 2: ESM toolchain

Swap every config file to the template's ESM setup and add `.js` extensions to relative imports. The six tests that need no module mocking are ported here. `main.test.ts`, `zip-sources.test.ts`, and `characterization.test.ts` cannot work until their fixtures exist, so they are **temporarily** excluded via `testPathIgnorePatterns`.

**That exclusion is scaffolding.** Task 3 removes one entry, Task 4 removes the rest. The suite is not trustworthy until Task 4 completes.

**Files:**
- Create: `.node-version`, `.prettierrc.yml`
- Delete: `.prettierrc.json`, `__tests__/tsconfig.json`, `__tests__/.eslintrc.json`
- Modify: `package.json`, `tsconfig.json`, `jest.config.js`, `eslint.config.mjs`, `.prettierignore`
- Modify: every file under `src/` (relative import extensions)
- Modify: `__tests__/{environment,log-level,memory,secrets,service-account-json,mounts}.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: ESM module graph. Every `src/` module is importable as `../src/<path>.js` from tests. `src/parse/index.js` and `src/storage/index.js` are the directory entry points.

- [ ] **Step 1: Pin the Node version**

Create `.node-version` containing exactly:

```
24.4.0
```

- [ ] **Step 2: Rewrite package.json**

**Delete** the `"main": "lib/src/index.js"` field — nothing consumes it and `lib/` is going away. Replace `scripts` and `devDependencies`, and add `type`/`exports`/`engines`. Keep `name`, `version`, `description`, `repository`, `keywords`, `author`, `license`, `overrides`, and the `git-tag` script exactly as they are — releases read `version` from here.

```json
{
  "name": "yc-actions-yc-sls-function",
  "version": "4.1.1",
  "description": "GitHub Action to deploy Serverless Function to Yandex Cloud.",
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "bundle": "npm run format:write && npm run package",
    "ci-test": "NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 GITHUB_WORKSPACE=__fixtures__/workspace npx jest --ci",
    "coverage": "npx make-coverage-badge --output-path ./badges/coverage.svg",
    "format:write": "npx prettier --write .",
    "format:check": "npx prettier --check .",
    "lint": "npx eslint .",
    "local-action": "npx @github/local-action . src/main.ts .env",
    "package": "npx rimraf ./dist && npx rollup --config rollup.config.ts --configPlugin @rollup/plugin-typescript",
    "package:watch": "npm run package -- --watch",
    "test": "NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 GITHUB_WORKSPACE=__fixtures__/workspace npx jest",
    "all": "npm run format:write && npm run lint && npm run test && npm run coverage && npm run package",
    "git-tag": "git tag v`cat package.json | jq -r '.version' | awk -F. '{print $1}'` -f &&  git tag v`cat package.json | jq -r '.version'` -f"
  }
}
```

`ci-test` carries `--ci` so CI can never write a snapshot.

- [ ] **Step 3: Swap dependencies**

```bash
npm uninstall @vercel/ncc eslint-plugin-github eslint-plugin-import eslint-import-resolver-typescript \
  @stylistic/eslint-plugin-ts eslint-plugin-jsonc @types/mustache js-yaml
npm install --save-dev @eslint/compat @github/local-action @jest/globals @rollup/plugin-commonjs \
  @rollup/plugin-node-resolve @rollup/plugin-typescript eslint-config-prettier make-coverage-badge \
  rimraf rollup ts-jest-resolver
```

`eslint-plugin-import` and `eslint-import-resolver-typescript` go because the new flat config drops the
`settings['import/resolver']` block and `eslint-plugin-github` (which pulled them in) is gone. **This means the
`// eslint-disable-next-line import/no-namespace` comments in the tests now reference a rule that no longer
exists** — Task 4 deletes them when it rewrites those files. Verify none remain:

```bash
grep -rn "import/no-namespace" __tests__ __fixtures__ src
```

Expected after Task 4: no matches.

Keep `long`, `minimist`, and `path-scurry` in `dependencies` — they are explicit version pins for transitive packages from the security-advisory update in `1fbfe11`, not direct imports.

- [ ] **Step 4: Rewrite tsconfig.json**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "allowSyntheticDefaultImports": true,
    "declaration": false,
    "declarationMap": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "newLine": "lf",
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": false,
    "outDir": "./dist",
    "pretty": true,
    "resolveJsonModule": true,
    "strict": true,
    "strictNullChecks": true,
    "target": "ES2022"
  },
  "exclude": ["__fixtures__", "__tests__", "coverage", "dist", "node_modules"],
  "include": ["src"]
}
```

The template also sets `"lib": ["ES2022"]`. It is omitted here because `src/storage/storage-object.ts` uses `BufferEncoding` and `src/zip.ts` uses `Buffer`, which need the Node lib defaults.

- [ ] **Step 5: Delete the per-directory configs**

```bash
git rm __tests__/tsconfig.json __tests__/.eslintrc.json
```

Both existed to give the old CommonJS test build its own settings. The single root `tsconfig.json` now serves tests through ts-jest.

- [ ] **Step 6: Rewrite jest.config.js**

```js
// See: https://jestjs.io/docs/configuration

/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
    clearMocks: true,
    collectCoverage: true,
    collectCoverageFrom: ['./src/**'],
    coverageDirectory: './coverage',
    coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
    coverageReporters: ['json-summary', 'text', 'lcov'],
    extensionsToTreatAsEsm: ['.ts'],
    moduleFileExtensions: ['ts', 'js'],
    preset: 'ts-jest',
    reporters: ['default'],
    resolver: 'ts-jest-resolver',
    testEnvironment: 'node',
    testMatch: ['**/*.test.ts'],
    // SCAFFOLDING - Task 2 only. Task 3 removes zip-sources, Task 4 removes the
    // rest. The suite is incomplete until all three entries are gone.
    testPathIgnorePatterns: [
        '/dist/',
        '/node_modules/',
        '__tests__/main.test.ts',
        '__tests__/zip-sources.test.ts',
        '__tests__/characterization.test.ts'
    ],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: 'tsconfig.json',
                useESM: true
            }
        ]
    },
    verbose: true
}
```

- [ ] **Step 7: Rewrite eslint.config.mjs**

The template's config, with `allowDefaultProject` widened to cover nested fixture directories:

```js
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
        ignores: ['**/coverage', '**/dist', '**/node_modules']
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
                    // __fixtures__ is nested (__fixtures__/yandex-sdk/*.ts), so a
                    // single-level glob like the template's is not enough.
                    allowDefaultProject: [
                        '__fixtures__/**/*.ts',
                        '__tests__/**/*.ts',
                        'eslint.config.mjs',
                        'jest.config.js',
                        'rollup.config.ts'
                    ]
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
```

- [ ] **Step 8: Move the Prettier config to YAML, same values**

Create `.prettierrc.yml`:

```yaml
# See: https://prettier.io/docs/en/configuration
printWidth: 120
tabWidth: 4
useTabs: false
semi: false
singleQuote: true
quoteProps: as-needed
jsxSingleQuote: false
trailingComma: none
bracketSpacing: true
bracketSameLine: true
arrowParens: avoid
proseWrap: always
htmlWhitespaceSensitivity: css
endOfLine: lf
```

```bash
git rm .prettierrc.json
```

Replace `.prettierignore` with:

```
coverage/
dist/
node_modules/
package-lock.json
__tests__/__snapshots__/
```

- [ ] **Step 9: Add `.js` to every relative import in src/**

Exact edits, all of them:

| File | Change |
| --- | --- |
| `src/index.ts` | `'./main'` → `'./main.js'` |
| `src/main.ts` | `'./storage'` → `'./storage/index.js'` |
| `src/main.ts` | `'./storage/storage-object'` → `'./storage/storage-object.js'` |
| `src/main.ts` | `'./action-inputs'` → `'./action-inputs.js'` |
| `src/main.ts` | `'./service-account'` → `'./service-account.js'` |
| `src/main.ts` | `'./async-invocation'` → `'./async-invocation.js'` |
| `src/main.ts` | `'./parse'` → `'./parse/index.js'` |
| `src/main.ts` | `'./summary'` → `'./summary.js'` |
| `src/main.ts` | `'./zip'` → `'./zip.js'` |
| `src/main.ts` | `'./auth'` → `'./auth.js'` |
| `src/async-invocation.ts` | `'./action-inputs'` → `'./action-inputs.js'` |
| `src/async-invocation.ts` | `'./service-account'` → `'./service-account.js'` |
| `src/zip.ts` | `'./parse'` → `'./parse/index.js'` |
| `src/parse/index.ts` | `'./mounts'`, `'./glob-patterns'`, `'./environment-variables'`, `'./lockbox-variables'`, `'./log-level'`, `'./memory'`, `'./sa-json'` each gain `.js` |
| `src/storage/index.ts` | `'./storage-object'` → `'./storage-object.js'` |

`src/storage/storage-object.ts`, `src/auth.ts`, `src/summary.ts`, `src/service-account.ts`, and the seven `src/parse/*.ts` leaf modules have no relative imports to change.

- [ ] **Step 10: Verify the source typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors. A `TS2307 Cannot find module './x'` means a missed `.js`. A `TS6133 declared but never read` comes from the newly enabled `noUnusedLocals` — delete the unused binding.

- [ ] **Step 11: Port the six mock-free tests**

Only the import specifiers change. In `__tests__/environment.test.ts`, `__tests__/secrets.test.ts`, `__tests__/memory.test.ts`, `__tests__/log-level.test.ts`, `__tests__/mounts.test.ts`, and `__tests__/service-account-json.test.ts`:

```
'../src/parse'  ->  '../src/parse/index.js'
```

No other change. These use only the injected `describe`/`test`/`expect` globals, which still exist under ESM. They do not touch the `jest` object, which is *not* a global in ESM.

- [ ] **Step 12: Run the ported tests**

```bash
npm test
```

Expected: PASS. 6 suites run; `main.test.ts`, `zip-sources.test.ts`, and `characterization.test.ts` are reported as skipped by `testPathIgnorePatterns`. Coverage will be low — the floors are not enforced until Task 7.

- [ ] **Step 13: Run the linter and formatter**

```bash
npm run lint
npm run format:check
```

Expected: both pass. `format:check` should report no changes, because `.prettierrc.yml` carries the same values as the deleted `.prettierrc.json`. **If it wants to reformat source files, the values were transcribed wrong** — fix the YAML rather than reformatting the code.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "build: migrate toolchain to ESM per actions/typescript-action

Switches to type: module with NodeNext resolution, adds .js specifiers to
relative imports, and replaces the jest/eslint/prettier configs with the
template's. Prettier keeps this repo's 120/4/arrowParens:avoid values.

main.test.ts, zip-sources.test.ts, and characterization.test.ts are
temporarily excluded via testPathIgnorePatterns; their fixtures arrive in
the next two commits."
```

---

### Task 3: Zip fixtures and zip test

Move the zip test data to `__fixtures__/workspace/` and bring `zip-sources.test.ts` back into the suite.

The recorded snapshot paths (`./src/foo/1.txt`, `foo/1.txt`, …) are relative to `GITHUB_WORKSPACE`, so moving the whole tree and repointing the env var leaves them unchanged. **Do not update `__tests__/__snapshots__/zip-sources.test.ts.snap`.** The entry counts (`toBe(8)`, `toEqual(9)`, `toBe(4)`) depend on the exact file set, so move it wholesale — adding or dropping a file breaks them.

**Files:**
- Move: `__tests__/foo/` → `__fixtures__/workspace/foo/`
- Move: `__tests__/src/` → `__fixtures__/workspace/src/`
- Modify: `__tests__/zip-sources.test.ts`, `jest.config.js`

**Interfaces:**
- Consumes: the ESM toolchain from Task 2.
- Produces: `__fixtures__/workspace/` as `GITHUB_WORKSPACE` for all tests.

- [ ] **Step 1: Record the current file set**

```bash
find __tests__/foo __tests__/src -type f | sort
```

Expected, exactly 9 files:

```
__tests__/foo/1.txt
__tests__/foo/2.txt
__tests__/src/bar/1.txt
__tests__/src/bar/2.txt
__tests__/src/exclude.txt
__tests__/src/exclude.yaml
__tests__/src/foo/1.txt
__tests__/src/foo/2.txt
__tests__/src/func.js
```

- [ ] **Step 2: Move the tree**

```bash
mkdir -p __fixtures__/workspace
git mv __tests__/foo __fixtures__/workspace/foo
git mv __tests__/src __fixtures__/workspace/src
find __fixtures__/workspace -type f | sort
```

Expected: the same 9 files under `__fixtures__/workspace/`.

- [ ] **Step 3: Port the test's imports**

In `__tests__/zip-sources.test.ts`:

```
'../src/zip'  ->  '../src/zip.js'
```

No other change — the test builds its own `archiver` instance and reads `include`/`sourceRoot` relative to `GITHUB_WORKSPACE`.

- [ ] **Step 4: Re-enable the test**

In `jest.config.js`, remove `'__tests__/zip-sources.test.ts'` from `testPathIgnorePatterns`, leaving:

```js
    testPathIgnorePatterns: [
        '/dist/',
        '/node_modules/',
        '__tests__/main.test.ts',
        '__tests__/characterization.test.ts'
    ],
```

- [ ] **Step 5: Run the zip test against the committed snapshot**

```bash
npm test -- __tests__/zip-sources.test.ts --ci
```

Expected: PASS, no snapshots written. A snapshot mismatch means the move changed the file set or `GITHUB_WORKSPACE` is not pointing at `__fixtures__/workspace` — fix the cause, not the snapshot.

- [ ] **Step 6: Run the whole suite**

```bash
npm test
```

Expected: PASS, 7 suites.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: move zip fixtures to __fixtures__/workspace

Relocates the zip test data per the template's convention so __tests__/
holds only test files. Paths in the snapshot are relative to
GITHUB_WORKSPACE, so moving the tree and repointing the env var leaves the
recorded output unchanged."
```

---

### Task 4: SDK fixtures, main test, characterization test

The real gate. Port the SDK mocks to `__fixtures__/`, convert the two mocking tests to `jest.unstable_mockModule`, remove the scaffolding, and prove the characterization snapshot still matches.

Under ESM, mocking is opt-in per specifier, so every `jest.disableAutomock()` call disappears — modules that are not explicitly mocked are simply real. That is why `Function`, `Version`, `Mount`, `CreateFunctionVersionRequest` and friends need no mock entries: `src/main.ts` uses them to *build* requests, and they must stay real for the snapshot to mean anything.

For the same reason, two of the old mock files have **no** `__fixtures__` counterpart, even though the spec's layout listed a `logging-v1.ts`: `__tests__/__mocks__/@yandex-cloud/nodejs-sdk/logging-v1.ts` and `.../serverless-functions-v1/function.ts` existed only to re-export real symbols past jest's automocker. With opt-in mocking they are dead weight. Do not port them.

**Files:**
- Create: `__fixtures__/core.ts`, `__fixtures__/github.ts`, `__fixtures__/axios.ts`, `__fixtures__/storage.ts`, `__fixtures__/get-operation.ts`
- Create: `__fixtures__/yandex-sdk/{index,iam-v1,lockbox-v1,serverless-functions-v1}.ts`
- Delete: `__tests__/__mocks__/`, `src/storage/__mocks__/`
- Modify: `__tests__/main.test.ts`, `__tests__/characterization.test.ts`, `jest.config.js`

**Interfaces:**
- Consumes: `normalize()` from `__fixtures__/normalize-request.ts` (Task 1).
- Produces: from `__fixtures__/yandex-sdk/serverless-functions-v1.ts` — `FunctionServiceMock`, `functionService`, `__setFunctionList(v: Function[])`, `__setVersionList(v: Version[])`, `__setCreateFunctionFail(v: boolean)`, `__setCreateVersionFail(v: boolean)`. From `iam-v1.ts` — `ServiceAccountServiceMock`, `serviceAccountService`, `__setServiceAccountList(v: ServiceAccount[])`. From `lockbox-v1.ts` — `LockboxSecretServiceMock`, `secretService`, `__setLockboxVersions(v: LockboxVersion[])`. From `index.ts` — `Session`, `waitForOperation`, `errors`.

- [ ] **Step 1: Write the operation helper**

Create `__fixtures__/get-operation.ts` — the existing helper, unchanged apart from having no jest dependency:

```ts
import { Operation } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/operation/operation'
import { Writer } from 'protobufjs'

type PayloadClass<T> = {
    encode: (message: T, writer?: Writer) => Writer
    decode: (payload: Uint8Array) => T
    fromJSON: (payload: object) => T
}

export function getOperation<P, M>(
    payloadClass: PayloadClass<P>,
    data: object,
    metadataClass?: PayloadClass<M>,
    metadata?: object
): Operation {
    return Operation.fromJSON({
        id: 'operationid',
        response: {
            value: Buffer.from(payloadClass.encode(payloadClass.fromJSON(data)).finish()).toString('base64')
        },
        metadata: metadataClass
            ? {
                  value: Buffer.from(metadataClass.encode(metadataClass.fromJSON(metadata ?? {})).finish()).toString(
                      'base64'
                  )
              }
            : undefined,
        done: true
    })
}
```

- [ ] **Step 2: Write the @actions and axios fixtures**

Create `__fixtures__/core.ts`:

```ts
import type * as core from '@actions/core'
import { jest } from '@jest/globals'

export const debug = jest.fn<typeof core.debug>()
export const error = jest.fn<typeof core.error>()
export const info = jest.fn<typeof core.info>()
export const warning = jest.fn<typeof core.warning>()
export const startGroup = jest.fn<typeof core.startGroup>()
export const endGroup = jest.fn<typeof core.endGroup>()
export const setCommandEcho = jest.fn<typeof core.setCommandEcho>()
export const getInput = jest.fn<typeof core.getInput>()
export const getMultilineInput = jest.fn<typeof core.getMultilineInput>()
export const getBooleanInput = jest.fn<typeof core.getBooleanInput>()
export const getIDToken = jest.fn<typeof core.getIDToken>()
export const setOutput = jest.fn<typeof core.setOutput>()
export const setFailed = jest.fn<typeof core.setFailed>()

export const addHeading = jest.fn().mockReturnThis()
export const addList = jest.fn().mockReturnThis()
export const write = jest.fn(async () => undefined)

/** Mirrors core.summary's chainable builder. */
export const summary = { addHeading, addList, write }
```

Create `__fixtures__/github.ts`:

```ts
import { jest } from '@jest/globals'

export const context = {
    get repo() {
        return { owner: 'some-owner', repo: 'some-repo' }
    }
}

export const getOctokit = jest.fn()
```

Create `__fixtures__/axios.ts`:

```ts
import { jest } from '@jest/globals'

export const post = jest.fn(async () => ({
    status: 200,
    statusText: 'OK',
    data: { access_token: 'iam-token' }
}))

export const get = jest.fn()
export const put = jest.fn()

export default { post, get, put }
```

Create `__fixtures__/storage.ts` — replaces `src/storage/__mocks__/index.ts`:

```ts
import { jest } from '@jest/globals'
import { StorageObject } from '../src/storage/storage-object.js'

export const putObject = jest.fn(async () => undefined)

export class StorageServiceImpl {
    static __endpointId = 'storage'

    async getObject(bucketName: string, objectName: string): Promise<StorageObject> {
        return StorageObject.fromBuffer(bucketName, objectName, Buffer.from('object'))
    }

    async putObject(object: object): Promise<void> {
        return putObject(object)
    }
}
```

- [ ] **Step 3: Write the Yandex SDK fixtures**

Create `__fixtures__/yandex-sdk/iam-v1.ts`:

```ts
import { jest } from '@jest/globals'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'

let serviceAccounts: ServiceAccount[] = [ServiceAccount.fromJSON({ id: 'serviceaccountid' })]

export const ServiceAccountServiceMock = {
    list: jest.fn(() => ({ serviceAccounts }))
}

export function __setServiceAccountList(value: ServiceAccount[]): void {
    serviceAccounts = value
}

export const serviceAccountService = {
    ServiceAccountServiceClient: jest.fn(() => ServiceAccountServiceMock)
}
```

Create `__fixtures__/yandex-sdk/lockbox-v1.ts`:

```ts
import { jest } from '@jest/globals'
import { Version as LockboxVersion } from '@yandex-cloud/nodejs-sdk/lockbox-v1/secret'

let lockboxVersions: LockboxVersion[] = []

export const LockboxSecretServiceMock = {
    get: jest.fn(() => {
        // Newest createdAt wins - mirrors what Lockbox reports as currentVersion.
        const sorted = [...lockboxVersions].sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
        return { currentVersion: sorted[0] || undefined }
    })
}

export function __setLockboxVersions(value: LockboxVersion[]): void {
    lockboxVersions = value
}

export const secretService = {
    SecretServiceClient: jest.fn(() => LockboxSecretServiceMock)
}
```

Create `__fixtures__/yandex-sdk/serverless-functions-v1.ts` — the existing mock with `jest` imported and `jest.disableAutomock()` dropped:

```ts
import { jest } from '@jest/globals'
import {
    Function,
    Function_Status,
    Version,
    Version_Status
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { Operation } from '@yandex-cloud/nodejs-sdk/operation/operation'
import {
    CreateFunctionMetadata,
    CreateFunctionVersionMetadata
} from '@yandex-cloud/nodejs-sdk/serverless-functions-v1/function_service'

import { getOperation } from '../get-operation.js'

let functions: Function[] = []
let versions: Version[] = []
let createFunctionFail = false
let createVersionFail = false

export const FunctionServiceMock = {
    create: jest.fn(() => {
        if (createFunctionFail) {
            return Operation.fromJSON({ id: 'operationid', error: {}, done: true })
        }

        const data: Function = {
            id: 'functionid',
            folderId: 'folderid',
            createdAt: new Date(0),
            name: 'functionname',
            description: 'functiondescription',
            labels: {},
            httpInvokeUrl: 'https://functions.yandexcloud.net/fucntionid',
            status: Function_Status.ACTIVE
        }

        functions = [Function.fromJSON(data)]
        return getOperation(Function, data, CreateFunctionMetadata, { functionId: 'functionid' })
    }),
    get: jest.fn(() => functions[0]),
    list: jest.fn(() => ({ functions })),
    createVersion: jest.fn(() => {
        if (createVersionFail) {
            return Operation.fromJSON({ id: 'operationid', error: {}, done: true })
        }

        const data: Version = {
            id: 'versionid',
            functionId: 'functionid',
            createdAt: new Date(0),
            description: 'versiondescription',
            status: Version_Status.ACTIVE,
            runtime: 'python312',
            entrypoint: 'main.handler',
            serviceAccountId: 'serviceaccountid',
            imageSize: 0,
            tags: [],
            environment: { FOO: 'bar' },
            secrets: [],
            storageMounts: [],
            namedServiceAccounts: {},
            tmpfsSize: 0,
            concurrency: 0,
            mounts: []
        }

        versions = [Version.fromJSON(data)]
        return getOperation(Version, data, CreateFunctionVersionMetadata, { functionVersionId: 'versionid' })
    }),
    listVersions: jest.fn(() => ({ versions }))
}

export function __setCreateFunctionFail(value: boolean): void {
    createFunctionFail = value
}

export function __setCreateVersionFail(value: boolean): void {
    createVersionFail = value
}

export function __setFunctionList(value: Function[]): void {
    functions = value
}

export function __setVersionList(value: Version[]): void {
    versions = value
}

export const functionService = {
    FunctionServiceClient: jest.fn(() => FunctionServiceMock)
}
```

`createdAt` uses `new Date(0)` rather than `new Date()` so the returned operation payload is byte-stable across runs. The old mock used `new Date()`; the value is never read by the code under test.

Create `__fixtures__/yandex-sdk/index.ts`:

```ts
import { jest } from '@jest/globals'
import { errors } from '@yandex-cloud/nodejs-sdk'

// Real error classes - src/main.ts does `err instanceof errors.ApiError`.
export { errors }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Session = jest.fn().mockImplementation(() => ({
    client: (service: new () => unknown) => new service()
}))

// The fixtures return already-finished operations, so waiting is identity.
export const waitForOperation = jest.fn((op: unknown) => op)
```

- [ ] **Step 4: Delete the old mock directories**

```bash
git rm -r __tests__/__mocks__ src/storage/__mocks__
```

- [ ] **Step 5: Convert main.test.ts to unstable_mockModule**

Replace the import and setup block at the top of `__tests__/main.test.ts`. The mock declarations must come before the dynamic import of the module under test:

```ts
import { jest } from '@jest/globals'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ServiceAccount } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account'
import { Function } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { Version_Status } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'

import * as core from '../__fixtures__/core.js'
import * as github from '../__fixtures__/github.js'
import * as axios from '../__fixtures__/axios.js'
import * as storage from '../__fixtures__/storage.js'
import * as sdk from '../__fixtures__/yandex-sdk/index.js'
import {
    __setServiceAccountList,
    ServiceAccountServiceMock,
    serviceAccountService
} from '../__fixtures__/yandex-sdk/iam-v1.js'
import {
    __setCreateFunctionFail,
    __setCreateVersionFail,
    __setFunctionList,
    __setVersionList,
    FunctionServiceMock,
    functionService
} from '../__fixtures__/yandex-sdk/serverless-functions-v1.js'
import { __setLockboxVersions, secretService } from '../__fixtures__/yandex-sdk/lockbox-v1.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => github)
jest.unstable_mockModule('axios', () => axios)
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk', () => sdk)
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk/iam-v1', () => ({ serviceAccountService }))
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk/lockbox-v1', () => ({ secretService }))
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk/serverless-functions-v1', () => ({ functionService }))
jest.unstable_mockModule('../src/storage/index.js', () => storage)

const { run } = await import('../src/main.js')
const { writeSummary } = await import('../src/summary.js')
```

Then rework the bodies:

- Delete every `jest.spyOn(core, ...)` and the `errorMock`/`getInputMock`/`setFailedMock`/`setOutputMock`/`getIdTokenMock`/`axiosPostMock` variables. Assert on the fixture functions directly: `expect(core.setOutput).toHaveBeenCalledWith('function-id', 'functionid')`, `expect(core.setFailed).not.toHaveBeenCalled()`.
- Delete `jest.spyOn(context, 'repo', 'get')` — `__fixtures__/github.ts` already returns `{ owner: 'some-owner', repo: 'some-repo' }`.
- Delete `jest.spyOn(core, 'getIDToken')` and `jest.spyOn(axios, 'post')` — the fixtures provide those defaults.
- Replace `setupMockInputs` with:

```ts
function setupMockInputs(inputs: Record<string, string>) {
    core.getInput.mockImplementation((name: string) => inputs[name] || '')
    core.getBooleanInput.mockImplementation((name: string) => inputs[name] === 'true')
    core.getMultilineInput.mockImplementation((name: string) => (inputs[name] ? inputs[name].split('\n') : []))
}
```

- In the `writeSummary` describe block, drop the `jest.spyOn(core, 'summary', 'get')` setup and assert on `core.addHeading`, `core.addList`, and `core.write` from the fixture. Keep all four expected list payloads exactly as they are — they are the summary's contract.
- Keep the `beforeEach`/`afterEach` temp-summary-file handling and the `GITHUB_REPOSITORY`/`GITHUB_SHA` env vars unchanged.

- [ ] **Step 6: Convert characterization.test.ts to the same pattern**

Apply the identical mock header from Step 5 to `__tests__/characterization.test.ts`, then:

- Replace `jest.mock('../src/storage')` with the `jest.unstable_mockModule` block.
- Replace the `jest.spyOn(core, ...)` calls in `beforeEach` with nothing — the fixtures are already mocks. Keep `jest.clearAllMocks()`.
- Replace the per-scenario input setup with the same three `core.get*.mockImplementation` calls as `setupMockInputs`.
- Replace the awkward `jest.requireActual(...)` in the `function already exists` scenario with the direct import now available: `Function.fromJSON({ id: 'functionid', name: 'my-function', folder_id: 'folderid', status: 'ACTIVE' })`.
- Leave the `SCENARIOS` array and the `expect({...}).toMatchSnapshot()` assertion **byte-identical**. Those two are what the snapshot depends on.

- [ ] **Step 7: Remove the scaffolding**

In `jest.config.js`, delete the comment and the two remaining test entries so `testPathIgnorePatterns` is exactly the template's:

```js
    testPathIgnorePatterns: ['/dist/', '/node_modules/'],
```

- [ ] **Step 8: Verify the characterization snapshot still matches**

```bash
npm test -- __tests__/characterization.test.ts --ci
```

Expected: PASS, 15 tests, **zero** snapshots written or updated.

This is the gate for the entire rewrite. A diff here means behavior changed. Read the diff and fix the code — the snapshot is not to be regenerated. If the diff is only in a field that is genuinely non-deterministic and was missed in Task 1, add its key to `REDACTED_KEYS`, re-run Task 1's Step 3–4 on a clean checkout of the pre-rewrite code to regenerate a legitimate baseline, and note it in the commit message.

- [ ] **Step 9: Run the full suite**

```bash
npm test -- --ci
```

Expected: PASS, 9 suites, no snapshots written.

- [ ] **Step 10: Lint and typecheck**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "test: port suite to __fixtures__ and unstable_mockModule

Moves every test double to __fixtures__/ per the template and converts
main.test.ts and characterization.test.ts to ESM module mocking. The
characterization snapshot recorded before the migration is reproduced
byte-identically, so the deploy request payloads are unchanged.

Removes the testPathIgnorePatterns scaffolding; the full suite runs again."
```

---

### Task 5: Rollup bundle

Replace ncc with Rollup and prove the bundle actually loads.

**On the grpc-js protos:** the spec proposed copying `@grpc/grpc-js/proto/**` to `dist/proto/**` for parity with ncc. Working through it, that copy cannot achieve parity — `channelz.js` resolves `` `${__dirname}/../../proto` ``, and with `__dirname` shimmed to the real `dist/`, `../../proto` points *outside* the action checkout, not at `dist/proto`. Making it line up would require lying about `__dirname` (pointing it at a fake `dist/node_modules/@grpc/grpc-js/build/src`), which breaks `__dirname` for every other consumer in the bundle.

So: shim `__dirname` honestly and **do not** copy the protos. Both call sites are unreachable for a client-only action — `channelz.setup()` only registers a callback, and `orca.js` loads only under xds. With the shim in place, the failure mode if either were ever reached is a clear `ENOENT` on a real path rather than a `ReferenceError: __dirname is not defined`. Task 8's real deploy is the check on this reasoning.

**Files:**
- Create: `rollup.config.ts`, `__tests__/bundle.test.ts`
- Modify: `.gitignore`
- Delete: `dist/licenses.txt`, `dist/sourcemap-register.js`, `dist/xds/`, `dist/protoc-gen-validate/`, `dist/proto/`

**Interfaces:**
- Consumes: `src/index.ts` as the bundle entry.
- Produces: `dist/index.js` (ESM) and `dist/index.js.map`.

- [ ] **Step 1: Write the Rollup config**

Create `rollup.config.ts`:

```ts
// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

/**
 * CommonJS dependencies in this graph (@yandex-cloud/nodejs-sdk, @grpc/grpc-js,
 * archiver) reference `require`, `__filename`, and `__dirname`, which do not
 * exist in an ES module. Define them from import.meta.url.
 *
 * @grpc/grpc-js additionally resolves `${__dirname}/../../proto` when channelz
 * or ORCA load reporting is enabled. Neither is reachable for a client-only
 * action - channelz.setup() merely registers a callback - so those .proto files
 * are not shipped. With __dirname defined, that path fails as a plain ENOENT if
 * it is ever reached.
 */
const banner = [
    "import { createRequire as __createRequire } from 'node:module'",
    "import { dirname as __pathDirname } from 'node:path'",
    "import { fileURLToPath as __fileURLToPath } from 'node:url'",
    'const require = __createRequire(import.meta.url)',
    'const __filename = __fileURLToPath(import.meta.url)',
    'const __dirname = __pathDirname(__filename)'
].join('\n')

const config = {
    input: 'src/index.ts',
    output: {
        banner,
        esModule: true,
        file: 'dist/index.js',
        format: 'es',
        inlineDynamicImports: true,
        sourcemap: true
    },
    plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs()]
}

export default config
```

- [ ] **Step 2: Write the bundle smoke test**

Create `__tests__/bundle.test.ts`. This runs the real bundle in a subprocess with no mocks — the only test that proves the ESM output loads and the grpc-js/archiver graphs initialize.

```ts
/**
 * Smoke test for the built bundle.
 *
 * Unit tests mock the SDK, so they cannot catch a bundle that fails to load.
 * This runs dist/index.js in a subprocess with no credentials and asserts it
 * reaches the action's own validation rather than a module-resolution error.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

describe('dist/index.js', () => {
    it('loads and fails with No credentials', async () => {
        if (!existsSync('dist/index.js')) {
            throw new Error('dist/index.js is missing - run `npm run package` first')
        }

        // writeSummary() runs in main's finally block and needs this file.
        const dir = mkdtempSync(path.join(tmpdir(), 'yc-sls-smoke-'))
        const summaryFile = path.join(dir, 'summary.md')
        writeFileSync(summaryFile, '')

        let stdout = ''
        let code: number | undefined
        try {
            const result = await execFileAsync(process.execPath, ['dist/index.js'], {
                env: {
                    ...process.env,
                    GITHUB_STEP_SUMMARY: summaryFile,
                    GITHUB_SHA: 'sha',
                    GITHUB_REPOSITORY: 'owner/repo'
                }
            })
            stdout = result.stdout
            code = 0
        } catch (err) {
            const e = err as { code?: number; stdout?: string; stderr?: string }
            stdout = `${e.stdout ?? ''}${e.stderr ?? ''}`
            code = e.code
        }

        expect(stdout).toContain('No credentials')
        expect(stdout).not.toContain('Cannot find module')
        expect(stdout).not.toContain('is not defined')
        expect(code).toBe(1)
    }, 60000)
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx rimraf ./dist
npm test -- __tests__/bundle.test.ts
```

Expected: FAIL with `dist/index.js is missing - run npm run package first`.

- [ ] **Step 4: Build the bundle**

```bash
npm run package
ls -la dist/
```

Expected: `dist/index.js` and `dist/index.js.map` exist and nothing else.

If Rollup errors on a dynamic `require` in `archiver` or the SDK, first try adding it to `commonjs({ dynamicRequireTargets: [...] })`. If the bundle cannot be produced at all, stop and take the ncc fallback recorded in the spec's Risks section — reinstate `@vercel/ncc`, set `"package": "ncc build --source-map --license licenses.txt"`, and add `dist/package.json` containing `{"type":"commonjs"}`. Everything else in this plan stands unchanged.

- [ ] **Step 5: Run the smoke test**

```bash
npm test -- __tests__/bundle.test.ts
```

Expected: PASS.

A `ReferenceError: require is not defined` or `__dirname is not defined` means the banner did not apply — check `output.banner` is inside `output`, not at the config root. A `Cannot find module` names the dependency Rollup failed to inline.

- [ ] **Step 6: Remove the ncc artifacts**

```bash
git rm -r --cached dist/licenses.txt dist/sourcemap-register.js dist/xds dist/protoc-gen-validate dist/proto
rm -rf dist/licenses.txt dist/sourcemap-register.js dist/xds dist/protoc-gen-validate dist/proto
git status --short dist/
```

Expected: only `dist/index.js` and `dist/index.js.map` remain tracked.

- [ ] **Step 7: Drop `lib/` from .gitignore and disk**

`lib/` was `tsc` output that nothing consumed; `outDir` is now `dist`. Remove the `lib` entry from `.gitignore` if present, and:

```bash
rm -rf lib
```

- [ ] **Step 8: Run the full suite**

```bash
npm test -- --ci
```

Expected: PASS, 10 suites, no snapshots written.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "build: bundle with Rollup instead of ncc

Emits an ESM dist/index.js with a banner defining require, __filename,
and __dirname for the CommonJS dependencies in the graph.

Drops the .proto files ncc copied. grpc-js resolves them from
\${__dirname}/../../proto, which cannot be made to point inside dist/
without lying about __dirname, and both call sites (channelz, ORCA) are
unreachable for a client-only action. With __dirname defined the failure
mode is a plain ENOENT rather than a ReferenceError.

Adds a subprocess smoke test asserting the bundle loads and reaches the
action's own credential validation."
```

---

### Task 6: Split main.ts

Move the four business functions out of `main.ts` into focused modules. Pure code movement — the characterization snapshot must not budge.

**Files:**
- Create: `src/function/create.ts`, `src/function/version.ts`, `src/lockbox.ts`, `src/upload.ts`
- Modify: `src/main.ts`, `src/action-inputs.ts`

**Interfaces:**
- Consumes: `ActionInputs` from `src/action-inputs.js`, `Secret` from `src/parse/index.js`.
- Produces:
  - `getOrCreateFunctionId(session: Session, inputs: ActionInputs): Promise<string>` — `src/function/create.js`
  - `createFunctionVersion(session: Session, functionId: string, fileContents: Buffer, bucketObjectName: string, inputs: ActionInputs): Promise<string>` — `src/function/version.js`
  - `resolveLatestLockboxVersions(session: Session, secrets: Secret[]): Promise<Secret[]>` — `src/lockbox.js`
  - `uploadToS3(bucket: string, functionId: string, sessionConfig: SessionConfig, fileContents: Buffer): Promise<string>` — `src/upload.js`
  - `readInputs(): ActionInputs` — `src/action-inputs.js`

- [ ] **Step 1: Extract uploadToS3**

Create `src/upload.ts` by moving `uploadToS3` out of `src/main.ts:71-93` verbatim, with its JSDoc:

```ts
/**
 * Function code upload to Yandex Object Storage.
 *
 * @module
 */

import { info, setFailed } from '@actions/core'
import { SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'
import { StorageServiceImpl } from './storage/index.js'
import { StorageObject } from './storage/storage-object.js'

/**
 * Uploads function code zip archive to Yandex Object Storage.
 *
 * Creates object name from function ID and GitHub commit SHA.
 *
 * @param bucket - S3 bucket name
 * @param functionId - Yandex Cloud function ID
 * @param sessionConfig - Session configuration with auth credentials
 * @param fileContents - Zip file buffer to upload
 * @returns Object name in format: `{functionId}/{GITHUB_SHA}.zip`
 * @throws {Error} If GITHUB_SHA environment variable is missing
 */
export async function uploadToS3(
    bucket: string,
    functionId: string,
    sessionConfig: SessionConfig,
    fileContents: Buffer
): Promise<string> {
    const { GITHUB_SHA } = process.env

    if (!GITHUB_SHA) {
        setFailed('Missing GITHUB_SHA')
        throw new Error('Missing GITHUB_SHA')
    }

    //setting object name
    const bucketObjectName = `${functionId}/${GITHUB_SHA}.zip`
    info(`Upload to bucket: "${bucket}/${bucketObjectName}"`)

    const storageService = new StorageServiceImpl(sessionConfig)

    const storageObject = StorageObject.fromBuffer(bucket, bucketObjectName, fileContents)
    await storageService.putObject(storageObject)
    return bucketObjectName
}
```

- [ ] **Step 2: Extract resolveLatestLockboxVersions**

Create `src/lockbox.ts` by moving `src/main.ts:163-180` verbatim:

```ts
/**
 * Lockbox secret version resolution.
 *
 * @module
 */

import { Session } from '@yandex-cloud/nodejs-sdk'
import { secretService } from '@yandex-cloud/nodejs-sdk/lockbox-v1'
import { GetSecretRequest } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret_service'
import { Secret } from './parse/index.js'

/**
 * Resolves 'latest' versionId to actual version ID for Lockbox secrets.
 *
 * Fetches current version from Lockbox API when versionId is 'latest'.
 * Otherwise returns secret unchanged.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param secrets - Array of secrets that may contain 'latest' versionId
 * @returns Secrets with resolved version IDs
 * @throws {Error} If secret has no current version
 *
 * @see ADR 002 for rationale on 'latest' version resolution
 */
export async function resolveLatestLockboxVersions(session: Session, secrets: Secret[]): Promise<Secret[]> {
    const lockboxClient = session.client(secretService.SecretServiceClient)
    const resolved: Secret[] = []
    for (const secret of secrets) {
        if (secret.versionId !== 'latest') {
            resolved.push(secret)
            continue
        }
        // Fetch secret metadata to get current version ID
        const resp = await lockboxClient.get(GetSecretRequest.fromPartial({ secretId: secret.id }))
        if (!resp.currentVersion) {
            throw new Error(`No current version found for Lockbox secret: ${secret.id}`)
        }
        // Replace 'latest' with actual version ID for stable deployments
        resolved.push({ ...secret, versionId: resp.currentVersion.id })
    }
    return resolved
}
```

- [ ] **Step 3: Extract getOrCreateFunctionId**

Create `src/function/create.ts` by moving `src/main.ts:106-148` verbatim. Note the relative imports gain an extra `../` level:

```ts
/**
 * Function lookup and creation.
 *
 * @module
 */

import { endGroup, error, info, setOutput, startGroup } from '@actions/core'
import { context } from '@actions/github'
import { Session, waitForOperation } from '@yandex-cloud/nodejs-sdk'
import { functionService } from '@yandex-cloud/nodejs-sdk/serverless-functions-v1'
import {
    CreateFunctionMetadata,
    CreateFunctionRequest,
    ListFunctionsRequest
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function_service'
import { ActionInputs } from '../action-inputs.js'

/**
 * Finds existing function by name or creates new one in the folder.
 *
 * Searches for function by exact name match. If not found, creates new function
 * with description linking to GitHub repository.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param inputs - Action inputs containing folderId and functionName
 * @returns Function ID (existing or newly created)
 * @throws {Error} If function creation fails or ID cannot be resolved
 */
export async function getOrCreateFunctionId(
    session: Session,
    { folderId, functionName }: ActionInputs
): Promise<string> {
    startGroup('Find function id')
    const client = session.client(functionService.FunctionServiceClient)

    const res = await client.list(
        ListFunctionsRequest.fromPartial({
            folderId,
            filter: `name = '${functionName}'`
        })
    )
    let functionId: string
    // If there is a function with the provided name in given folder, then return its id
    if (res.functions.length) {
        functionId = res.functions[0].id
        info(`'There is the function named '${functionName}' in the folder already. Its id is '${functionId}'`)
    } else {
        // Otherwise create new a function and return its id.
        const repo = context.repo

        const op = await client.create(
            CreateFunctionRequest.fromPartial({
                folderId,
                name: functionName,
                description: `Created from ${repo.owner}/${repo.repo}`
            })
        )
        const finishedOp = await waitForOperation(op, session)
        if (finishedOp.metadata) {
            const meta = CreateFunctionMetadata.decode(finishedOp.metadata.value)
            functionId = meta.functionId
            info(
                `There was no function named '${functionName}' in the folder. So it was created. Id is '${functionId}'`
            )
        } else {
            error(`Failed to create function '${functionName}'`)
            throw new Error('Failed to create function')
        }
        if (!functionId) throw new Error('Function ID not resolved')
    }
    setOutput('function-id', functionId)
    endGroup()
    return functionId
}
```

- [ ] **Step 4: Extract createFunctionVersion**

Create `src/function/version.ts` by moving `src/main.ts:204-297` verbatim, importing `resolveLatestLockboxVersions` from the new `../lockbox.js`:

```ts
/**
 * Function version creation.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { debug, endGroup, error, info, setFailed, setOutput, startGroup } from '@actions/core'
import { Session, waitForOperation } from '@yandex-cloud/nodejs-sdk'
import { functionService } from '@yandex-cloud/nodejs-sdk/serverless-functions-v1'
import { CreateFunctionVersionRequest } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function_service'
import { CreateFunctionVersionMetadata } from '@yandex-cloud/nodejs-sdk/serverless-functions-v1/function_service'
import { ActionInputs } from '../action-inputs.js'
import { createAsyncInvocationConfig } from '../async-invocation.js'
import { resolveLatestLockboxVersions } from '../lockbox.js'
import { parseEnvironmentVariables, parseLockboxVariables, parseMounts } from '../parse/index.js'
import { resolveServiceAccountId } from '../service-account.js'

/**
 * Creates new version of Yandex Cloud Function with provided configuration.
 *
 * Orchestrates version creation including:
 * - Service account resolution
 * - Lockbox secret version resolution
 * - Environment variables parsing
 * - Async invocation config creation
 * - Package upload (S3 or inline)
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param functionId - Target function ID
 * @param fileContents - Zip archive buffer containing function code
 * @param bucketObjectName - S3 object name (empty if inline upload)
 * @param inputs - Complete action inputs configuration
 * @returns Created function version ID
 * @throws {Error} If version creation fails or payload exceeds 3.5MB without bucket
 *
 * @remarks
 * Inline uploads are limited to 3670016 bytes (3.5 MB).
 * For larger payloads, provide bucket name for S3 upload.
 */
export async function createFunctionVersion(
    session: Session,
    functionId: string,
    fileContents: Buffer,
    bucketObjectName: string,
    inputs: ActionInputs
): Promise<string> {
    startGroup('Create function version')
    try {
        info(`Function '${inputs.functionName}' ${functionId}`)

        //convert variables
        info(`Parsed memory: "${inputs.memory}"`)
        info(`Parsed timeout: "${inputs.executionTimeout}"`)

        const serviceAccountId = await resolveServiceAccountId(
            session,
            inputs.folderId,
            inputs.serviceAccount,
            inputs.serviceAccountName
        )

        // Parse and resolve secrets
        let secrets = parseLockboxVariables(inputs.secrets)
        secrets = await resolveLatestLockboxVersions(session, secrets)

        const client = session.client(functionService.FunctionServiceClient)
        const request = CreateFunctionVersionRequest.fromJSON({
            functionId,
            runtime: inputs.runtime,
            entrypoint: inputs.entrypoint,
            resources: {
                memory: inputs.memory
            },
            serviceAccountId,
            description: inputs.description,
            environment: parseEnvironmentVariables(inputs.environment),
            executionTimeout: { seconds: inputs.executionTimeout },
            secrets,
            tag: inputs.tags,
            connectivity: {
                networkId: inputs.networkId
            },
            logOptions: {
                disabled: inputs.logsDisabled,
                logGroupId: inputs.logsGroupId,
                minLevel: inputs.logLevel
            },
            asyncInvocationConfig: await createAsyncInvocationConfig(session, inputs)
        })

        // Add mounts if provided
        if (inputs.mounts && inputs.mounts.length > 0) {
            request.mounts = parseMounts(inputs.mounts)
        }
        // Use S3 bucket upload for larger payloads
        if (inputs.bucket) {
            info(`From bucket: "${inputs.bucket}"`)
            // Include SHA256 hash for content verification
            const sha256 = createHash('sha256').update(fileContents).digest('hex')
            request.package = { bucketName: inputs.bucket, objectName: bucketObjectName, sha256 }
        } else {
            // Inline upload limited to 3.5 MB (3670016 bytes)
            // For larger payloads, caller should provide bucket name
            if (fileContents.length > 3670016) {
                throw Error(`Zip file is too big: ${fileContents.length} bytes. Provide bucket name.`)
            }
            request.content = fileContents
        }
        // Create new version
        const operation = await client.createVersion(request)
        debug(`Operation created: ${operation.id}`)
        const finishedOp = await waitForOperation(operation, session)
        debug(`Operation finished: ${finishedOp.id}`)
        if (finishedOp.metadata) {
            info(`Function version created: ${finishedOp.id}`)
            const meta = CreateFunctionVersionMetadata.decode(finishedOp.metadata.value)
            setOutput('version-id', meta.functionVersionId)
            return meta.functionVersionId
        } else {
            error(`Failed to create function version`)
            throw new Error('Failed to create function version')
        }
    } catch (err) {
        if ('description' in (err as object)) {
            setFailed((err as { description: string }).description)
        } else {
            setFailed(err as Error)
        }
        throw err
    } finally {
        endGroup()
    }
}
```

The body is byte-identical to `src/main.ts:211-296`. The only changes in this file versus the original are the import specifiers above — `createHash` moves from `'crypto'` to `'node:crypto'` to match the `node:` prefix used elsewhere in `src/`, and `resolveLatestLockboxVersions` now comes from `../lockbox.js` instead of being defined in the same file.

- [ ] **Step 5: Extract readInputs**

Append to `src/action-inputs.ts`, moving the object literal from `src/main.ts:349-381` verbatim:

```ts
import { getBooleanInput, getInput, getMultilineInput } from '@actions/core'
import { parseLogLevel, parseMemory } from './parse/index.js'

/**
 * Reads every action input and parses it into the deployment configuration.
 *
 * @returns Parsed configuration
 * @throws {Error} If a required input is missing or a value fails to parse
 */
export function readInputs(): ActionInputs {
    return {
        folderId: getInput('folder-id', { required: true }),
        functionName: getInput('function-name', { required: true }),
        runtime: getInput('runtime', { required: true }),
        entrypoint: getInput('entrypoint', { required: true }),
        memory: parseMemory(getInput('memory', { required: false }) || '128Mb'),
        include: getMultilineInput('include', { required: false }),
        excludePattern: getMultilineInput('exclude', { required: false }),
        sourceRoot: getInput('source-root', { required: false }) || '.',
        executionTimeout: parseInt(getInput('execution-timeout', { required: false }) || '5', 10),
        environment: getMultilineInput('environment', { required: false }),
        serviceAccount: getInput('service-account', { required: false }),
        serviceAccountName: getInput('service-account-name', { required: false }),
        bucket: getInput('bucket', { required: false }),
        description: getInput('description', { required: false }),
        secrets: getMultilineInput('secrets', { required: false }),
        networkId: getInput('network-id', { required: false }),
        tags: getMultilineInput('tags', { required: false }),
        logsDisabled: getBooleanInput('logs-disabled', { required: false }) || false,
        logsGroupId: getInput('logs-group-id', { required: false }),
        logLevel: parseLogLevel(getInput('log-level', { required: false, trimWhitespace: true })),
        async: getBooleanInput('async', { required: false }),
        asyncSaId: getInput('async-sa-id', { required: false }),
        asyncSaName: getInput('async-sa-name', { required: false }),
        asyncRetriesCount: parseInt(getInput('async-retries-count', { required: false }) || '3', 10),
        asyncSuccessYmqArn: getInput('async-success-ymq-arn', { required: false }),
        asyncSuccessSaId: getInput('async-success-sa-id', { required: false }),
        asyncFailureYmqArn: getInput('async-failure-ymq-arn', { required: false }),
        asyncFailureSaId: getInput('async-failure-sa-id', { required: false }),
        asyncSuccessSaName: getInput('async-success-sa-name', { required: false }),
        asyncFailureSaName: getInput('async-failure-sa-name', { required: false }),
        mounts: getMultilineInput('mounts', { required: false })
    }
}
```

Key ordering in this literal is preserved exactly. `normalize()` sorts keys, so ordering cannot affect the snapshot — but keeping it identical makes the diff reviewable.

- [ ] **Step 6: Reduce main.ts to orchestration**

Replace `src/main.ts` entirely:

```ts
/**
 * Main entry point for Yandex Cloud Serverless Function deployment.
 *
 * Handles authentication (SA JSON, IAM token, WIF) and orchestrates the deploy:
 * zip, find-or-create function, optional S3 upload, create version, summary.
 *
 * @see {@link https://github.com/yc-actions/yc-sls-function} for usage examples
 * @module
 */

import { error, getIDToken, getInput, info, setCommandEcho, setFailed, setOutput } from '@actions/core'
import { errors, Session } from '@yandex-cloud/nodejs-sdk'
import { SessionConfig } from '@yandex-cloud/nodejs-sdk/dist/types'
import archiver from 'archiver'

import { ActionInputs, readInputs } from './action-inputs.js'
import { exchangeToken } from './auth.js'
import { getOrCreateFunctionId } from './function/create.js'
import { createFunctionVersion } from './function/version.js'
import { parseServiceAccountJsonFile } from './parse/index.js'
import { writeSummary } from './summary.js'
import { uploadToS3 } from './upload.js'
import { zipSources } from './zip.js'

/**
 * Resolves credentials from the action inputs.
 *
 * Priority: Service Account JSON, then IAM token, then Workload Identity
 * Federation via the GitHub OIDC token.
 *
 * @returns Session configuration for the Yandex Cloud SDK
 * @throws {Error} If no credentials are provided
 */
async function resolveSessionConfig(): Promise<SessionConfig> {
    const ycSaJsonCredentials = getInput('yc-sa-json-credentials')
    const ycIamToken = getInput('yc-iam-token')
    const ycSaId = getInput('yc-sa-id')

    if (ycSaJsonCredentials !== '') {
        const serviceAccountJson = parseServiceAccountJsonFile(ycSaJsonCredentials)
        info('Parsed Service account JSON')
        return { serviceAccountJson }
    }
    if (ycIamToken !== '') {
        info('Using IAM token')
        return { iamToken: ycIamToken }
    }
    if (ycSaId !== '') {
        // Workload Identity Federation: exchange GitHub OIDC token for Yandex IAM token
        const ghToken = await getIDToken()
        if (!ghToken) {
            throw new Error('No credentials provided')
        }
        const saToken = await exchangeToken(ghToken, ycSaId)
        return { iamToken: saToken }
    }
    throw new Error('No credentials')
}

/**
 * Main entry point for GitHub Action execution.
 *
 * @throws {Error} Sets action as failed on any error
 */
export async function run(): Promise<void> {
    setCommandEcho(true)
    let functionId = ''
    let versionId = ''
    let bucketObjectName = ''
    let errorMessage = ''
    let inputs: ActionInputs | undefined = undefined
    try {
        const sessionConfig = await resolveSessionConfig()
        const session = new Session(sessionConfig)
        inputs = readInputs()
        info('Function inputs set')
        const archive = archiver('zip', { zlib: { level: 9 } })
        const fileContents = await zipSources(inputs, archive)
        info(`Buffer size: ${Buffer.byteLength(fileContents)}b`)
        functionId = await getOrCreateFunctionId(session, inputs)
        if (inputs.bucket) {
            bucketObjectName = await uploadToS3(inputs.bucket, functionId, sessionConfig, fileContents)
        }
        versionId = await createFunctionVersion(session, functionId, fileContents, bucketObjectName, inputs)
        setOutput('time', new Date().toTimeString())
    } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err)
        if (err instanceof errors.ApiError) {
            error(`${err.message}\nx-request-id: ${err.requestId}\nx-server-trace-id: ${err.serverTraceId}`)
        }
        setFailed(err as Error)
    } finally {
        await writeSummary({
            functionName: inputs?.functionName,
            functionId,
            versionId,
            bucket: inputs?.bucket,
            bucketObjectName,
            errorMessage,
            folderId: inputs?.folderId
        })
    }
}
```

`resolveSessionConfig` is the one behavior-relevant restructure: the original `if/else if/else` chain becomes early returns. The branch order and the two thrown messages (`'No credentials provided'`, `'No credentials'`) are identical, which is what the three credential-path scenarios in the characterization snapshot check.

- [ ] **Step 7: Add the storage mock path to main.test.ts**

`src/main.ts` no longer imports `./storage/index.js` — `src/upload.ts` does. The existing `jest.unstable_mockModule('../src/storage/index.js', () => storage)` still intercepts it, because the specifier resolves to the same module. No test change needed; confirm by running the suite.

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. `noUnusedLocals` will flag any import left behind in `main.ts`.

- [ ] **Step 9: Verify the snapshot did not move**

```bash
npm test -- __tests__/characterization.test.ts --ci
```

Expected: PASS, 15 tests, zero snapshots written. This is the proof that the split was pure movement.

- [ ] **Step 10: Full suite and bundle**

```bash
npm test -- --ci
npm run package
npm test -- __tests__/bundle.test.ts
npm run lint
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: split main.ts into focused modules

Moves uploadToS3, getOrCreateFunctionId, createFunctionVersion, and
resolveLatestLockboxVersions into src/upload.ts, src/function/create.ts,
src/function/version.ts, and src/lockbox.ts, and input reading into
readInputs() beside the ActionInputs type. main.ts keeps credential
resolution and orchestration.

Pure movement - the characterization snapshot is unchanged."
```

---

### Task 7: CI and lint configs

**Files:**
- Create: `.github/workflows/ci.yml`, `.markdown-lint.yml`, `.yaml-lint.yml`, `actionlint.yml`, `badges/coverage.svg`
- Replace: `.github/workflows/check-dist.yml`, `.github/workflows/linter.yml`
- Delete: `.github/workflows/test.yml`, `.github/linters/`
- Modify: `jest.config.js` (coverage thresholds)

**Interfaces:**
- Consumes: the `format:check`, `lint`, `ci-test`, `coverage`, `bundle` scripts from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Generate the coverage badge**

```bash
npm test
npm run coverage
node -e "const t=require('./coverage/coverage-summary.json').total; for (const k of ['lines','statements','functions','branches']) console.log(k, t[k].pct)"
```

Record the four printed percentages. `badges/coverage.svg` is now created.

- [ ] **Step 2: Add the coverage thresholds**

In `jest.config.js`, add after `coverageReporters`:

```js
    coverageThreshold: {
        global: {
            branches: 42,
            functions: 45,
            lines: 50,
            statements: 50
        }
    },
```

These are the pre-rewrite floors from the spec. If Step 1 printed a number *below* its floor, the split left something untested — add the missing test rather than lowering the value.

- [ ] **Step 3: Verify the thresholds hold**

```bash
npm test -- --ci
```

Expected: PASS with no `Jest: "global" coverage threshold ... not met` message.

- [ ] **Step 4: Write ci.yml**

Create `.github/workflows/ci.yml`. The template's `test-action` job is replaced by a bundle smoke test, because running this action for real needs Yandex Cloud credentials:

```yaml
name: Continuous Integration

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  test-typescript:
    name: TypeScript Tests
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        id: checkout
        uses: actions/checkout@v7

      - name: Setup Node.js
        id: setup-node
        uses: actions/setup-node@v7
        with:
          node-version-file: .node-version
          cache: npm

      - name: Install Dependencies
        id: npm-ci
        run: npm ci

      - name: Check Format
        id: npm-format-check
        run: npm run format:check

      - name: Lint
        id: npm-lint
        run: npm run lint

      - name: Test
        id: npm-ci-test
        run: npm run ci-test

  test-bundle:
    name: Bundle Smoke Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        id: checkout
        uses: actions/checkout@v7

      - name: Setup Node.js
        id: setup-node
        uses: actions/setup-node@v7
        with:
          node-version-file: .node-version
          cache: npm

      - name: Install Dependencies
        id: npm-ci
        run: npm ci

      - name: Build Bundle
        id: package
        run: npm run package

      - name: Run Bundle Smoke Test
        id: smoke
        run: npm run ci-test -- __tests__/bundle.test.ts
```

- [ ] **Step 5: Replace check-dist.yml**

Replace `.github/workflows/check-dist.yml` entirely. The current one runs `npm run build` (which wrote `lib/`) and diffs `dist/`, so it could never detect a stale bundle:

```yaml
# In TypeScript actions, `dist/` is a special directory. When you reference
# an action with the `uses:` property, `dist/index.js` is the code that will be
# run. For this project, the `dist/index.js` file is transpiled from other
# source files. This workflow ensures the `dist/` directory contains the
# expected transpiled code.
name: Check Transpiled JavaScript

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  check-dist:
    name: Check dist/
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        id: checkout
        uses: actions/checkout@v7

      - name: Setup Node.js
        id: setup-node
        uses: actions/setup-node@v7
        with:
          node-version-file: .node-version
          cache: npm

      - name: Remove dist/ Directory
        id: remove-dist
        run: npx rimraf ./dist

      - name: Install Dependencies
        id: install
        run: npm ci

      - name: Build dist/ Directory
        id: build
        run: npm run bundle

      - name: Compare Directories
        id: diff
        run: |
          if [ ! -d dist/ ]; then
            echo "Expected dist/ directory does not exist.  See status below:"
            ls -la ./
            exit 1
          fi
          if [ "$(git diff --ignore-space-at-eol --text dist/ | wc -l)" -gt "0" ]; then
            echo "Detected uncommitted changes after build. See status below:"
            git diff --ignore-space-at-eol --text dist/
            exit 1
          fi

      - if: ${{ failure() && steps.diff.outcome == 'failure' }}
        name: Upload Artifact
        id: upload
        uses: actions/upload-artifact@v7
        with:
          name: dist
          path: dist/
```

- [ ] **Step 6: Add the linter workflow and configs**

Create `.github/workflows/linter.yml`:

```yaml
name: Lint Codebase

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main

permissions:
  contents: read
  packages: read
  statuses: write

jobs:
  lint:
    name: Lint Codebase
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        id: checkout
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Setup Node.js
        id: setup-node
        uses: actions/setup-node@v7
        with:
          node-version-file: .node-version
          cache: npm

      - name: Install Dependencies
        id: install
        run: npm ci

      - name: Lint Codebase
        id: super-linter
        uses: super-linter/super-linter/slim@v8
        env:
          DEFAULT_BRANCH: main
          FILTER_REGEX_EXCLUDE: dist/**/*
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VALIDATE_ALL_CODEBASE: false
          VALIDATE_JAVASCRIPT_ES: false
          VALIDATE_JSCPD: false
          VALIDATE_TYPESCRIPT_ES: false
          VALIDATE_TYPESCRIPT_STANDARD: false
```

TypeScript and JavaScript validation are off because `npm run lint` in `ci.yml` already covers them with the project's own flat config.

Move the three stale linter configs to the root, where the template keeps them:

```bash
git mv .github/linters/.markdown-lint.yml .markdown-lint.yml
git mv .github/linters/.yaml-lint.yml .yaml-lint.yml
git rm .github/linters/tsconfig.json
```

Create `actionlint.yml`:

```yaml
self-hosted-runner:
  labels: []
config-variables: null
```

- [ ] **Step 7: Delete the superseded workflow**

```bash
git rm .github/workflows/test.yml
```

`ci.yml` covers everything it did.

- [ ] **Step 8: Validate the workflow YAML**

```bash
npx --yes yaml-lint .github/workflows/*.yml
npm run format:check
```

Expected: both pass. `format:check` now covers YAML too, since `prettier --write .` is not path-limited.

- [ ] **Step 9: Full verification**

```bash
npm test -- --ci
npm run lint
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "ci: adopt template workflows and enforce coverage floors

Adds ci.yml (format, lint, test) with a bundle smoke-test job in place of
the template's test-action job, which would need real Yandex Cloud
credentials.

Replaces check-dist.yml: the old one ran 'npm run build' (tsc, writing
lib/) and then diffed dist/, so it could never catch a stale bundle.

Adds super-linter with the lint configs moved out of the stale
.github/linters/, and sets jest coverage thresholds at the pre-rewrite
levels so regressions fail CI."
```

---

### Task 8: node24, local development, and release notes

The consumer-visible change plus the remaining template conveniences.

**Files:**
- Create: `.env.example`, `.vscode/extensions.json`, `.vscode/launch.json`
- Modify: `action.yml`, `.vscode/settings.json`, `README.md`, `CHANGELOG.md`, `package.json`

**Interfaces:**
- Consumes: the `local-action` script from Task 2.
- Produces: nothing.

- [ ] **Step 1: Switch the action runtime**

In `action.yml`, change line 171:

```yaml
runs:
  using: 'node24'
  main: 'dist/index.js'
```

Inputs, outputs, and branding are unchanged.

- [ ] **Step 2: Write .env.example**

Create `.env.example` covering every input, replacing the old `__tests__/.env.template`:

```ini
# Inputs for `npm run local-action`. Copy to .env and fill in.
# GitHub Actions passes inputs as INPUT_<NAME> with dashes preserved.

# Credentials - set exactly one of the three.
INPUT_YC-SA-JSON-CREDENTIALS=
INPUT_YC-IAM-TOKEN=
INPUT_YC-SA-ID=

# Required.
INPUT_FOLDER-ID=
INPUT_FUNCTION-NAME=
INPUT_RUNTIME=nodejs18
INPUT_ENTRYPOINT=index.handler

# Source selection.
INPUT_INCLUDE=.
INPUT_EXCLUDE=
INPUT_SOURCE-ROOT=.
INPUT_BUCKET=

# Version configuration.
INPUT_MEMORY=128Mb
INPUT_EXECUTION-TIMEOUT=5
INPUT_ENVIRONMENT=
INPUT_DESCRIPTION=
INPUT_SERVICE-ACCOUNT=
INPUT_SERVICE-ACCOUNT-NAME=
INPUT_SECRETS=
INPUT_NETWORK-ID=
INPUT_TAGS=
INPUT_MOUNTS=

# Logging.
INPUT_LOGS-DISABLED=false
INPUT_LOGS-GROUP-ID=
INPUT_LOG-LEVEL=

# Async invocation.
INPUT_ASYNC=false
INPUT_ASYNC-SA-ID=
INPUT_ASYNC-SA-NAME=
INPUT_ASYNC-RETRIES-COUNT=3
INPUT_ASYNC-SUCCESS-YMQ-ARN=
INPUT_ASYNC-SUCCESS-SA-ID=
INPUT_ASYNC-SUCCESS-SA-NAME=
INPUT_ASYNC-FAILURE-YMQ-ARN=
INPUT_ASYNC-FAILURE-SA-ID=
INPUT_ASYNC-FAILURE-SA-NAME=

# Runner context the action reads directly.
GITHUB_REPOSITORY=owner/repo
GITHUB_SHA=0000000000000000000000000000000000000000
GITHUB_WORKSPACE=.
```

```bash
git rm __tests__/.env.template
```

Confirm `.env` is covered by `.gitignore`; add it if not.

- [ ] **Step 3: Add the VS Code files, preserving local settings**

`.vscode/settings.json` already exists and is untracked, holding personal `workbench.colorCustomizations`. **Merge** — do not overwrite:

```json
{
    "workbench.colorCustomizations": {
        "activityBar.background": "#6D4C41",
        "titleBar.activeBackground": "#996A5B",
        "titleBar.activeForeground": "#FBF9F8",
        "titleBar.inactiveBackground": "#6D4C41",
        "titleBar.inactiveForeground": "#FBF9F8",
        "statusBar.background": "#6D4C41",
        "statusBar.foreground": "#FBF9F8",
        "statusBar.debuggingBackground": "#6D4C41",
        "statusBar.debuggingForeground": "#FBF9F8",
        "statusBar.noFolderBackground": "#6D4C41",
        "statusBar.noFolderForeground": "#FBF9F8"
    },
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true,
    "eslint.validate": ["javascript", "typescript"]
}
```

Read the existing file first and carry over whatever is actually in it — the block above reflects its current contents, but it is a local file and may have changed.

Create `.vscode/extensions.json`:

```json
{
  "recommendations": ["dbaeumer.vscode-eslint", "esbenp.prettier-vscode", "github.vscode-github-actions"]
}
```

Create `.vscode/launch.json` for debugging the action against real credentials via `local-action`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Local Action",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["@github/local-action", ".", "src/main.ts", ".env"],
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Debug Jest Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["jest", "--runInBand"],
      "env": {
        "NODE_OPTIONS": "--experimental-vm-modules",
        "GITHUB_WORKSPACE": "__fixtures__/workspace"
      },
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

`.vscode/mcp.json` from the template is skipped — it configures MCP servers unrelated to this action.

- [ ] **Step 4: Bump the version and write the changelog entry**

Set `"version": "5.0.0"` in `package.json`. The `node24` runtime is breaking for runners without it.

Prepend to `CHANGELOG.md`:

```markdown
## 5.0.0

### Breaking

- The action now runs on the `node24` Actions runtime. Self-hosted runners and
  GHES installations without the `node24` runtime must upgrade their runner
  before using `v5`.

### Changed

- Repository restructured onto the `actions/typescript-action` template: ESM
  source bundled with Rollup, `__fixtures__` test doubles, and the template's
  CI workflows. No change to action inputs, outputs, or deployment behavior.
- `check-dist` now rebuilds the bundle it verifies. Previously it built `lib/`
  and compared `dist/`, so a stale `dist/index.js` could be merged.
```

- [ ] **Step 5: Update the README development section**

Update the contributor-facing commands in `README.md` to the new script names — `npm run bundle`, `npm test`, `npm run lint`, `npm run local-action` — and note the Node 24 requirement. Leave the usage examples, input tables, and `uses:` snippets alone apart from bumping any `@v4` reference to `@v5`.

- [ ] **Step 6: Rebuild and verify everything**

```bash
npm ci
npm run all
npm test -- --ci
```

Expected: all pass, `dist/` regenerated, `badges/coverage.svg` updated.

- [ ] **Step 7: Confirm dist/ is clean**

```bash
npm run bundle
git status --short dist/
```

Expected: no output. If `dist/` is dirty, commit it — `check-dist.yml` fails otherwise.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat!: run on node24 and add local development tooling

BREAKING CHANGE: the action requires the node24 Actions runtime. Runners
without it must be upgraded before using v5.

Adds .env.example covering every input for npm run local-action, VS Code
launch configs for debugging the action and the test suite, and the v5
changelog entry. .vscode/settings.json is merged, preserving existing
local color customizations."
```

- [ ] **Step 9: Real deploy verification**

The last gate from the spec, and the only one that needs credentials. **Ask the user for a scratch folder ID and credentials before starting.**

1. Check out `main` (pre-rewrite) in a separate worktree and deploy a small test function to the scratch folder using a workflow that references the local action.
2. Record the resulting version configuration:

```bash
yc serverless function version get --id <version-id> --format json > /tmp/before.json
```

3. Deploy the same function from the rewrite branch to the **same** folder, producing a new version.
4. Record and compare:

```bash
yc serverless function version get --id <new-version-id> --format json > /tmp/after.json
diff <(jq 'del(.id, .created_at, .image_size, .function_id)' /tmp/before.json) \
     <(jq 'del(.id, .created_at, .image_size, .function_id)' /tmp/after.json)
```

Expected: empty diff. Anything else is a behavior change to investigate before merging.

`image_size` is excluded because the zip embeds file mtimes, so its byte size can differ between checkouts even for identical content.

- [ ] **Step 10: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide how to integrate. Note in the PR description that `v5` is a breaking release and the floating `v4` tag must **not** be moved to it.

---

## Notes for the implementer

**The characterization snapshot is the whole safety net.** If you find yourself wanting to run `jest -u`, stop. The snapshot was recorded against known-good code in Task 1; a mismatch after that point means the rewrite changed behavior. The only legitimate reason to regenerate it is a genuinely non-deterministic field missed in Task 1, and that requires re-recording against a clean pre-rewrite checkout.

**`testPathIgnorePatterns` is scaffolding, not configuration.** Task 2 adds three entries, Task 3 removes one, Task 4 removes the rest. If Task 4 ends with any test-file entry still in that array, the suite is silently incomplete.

**Watch for the `.js` extension on new relative imports.** Under `moduleResolution: NodeNext`, `./foo` and `./foo/index` both fail. Directory entry points need the full `./foo/index.js`.

**ESM mocking is opt-in.** Any module you do not pass to `jest.unstable_mockModule` is the real one. That is deliberate here: the protobuf message classes must stay real for the recorded requests to mean anything.
