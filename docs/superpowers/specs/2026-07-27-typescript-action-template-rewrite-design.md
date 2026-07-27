# Rewrite yc-sls-function onto the actions/typescript-action template

Date: 2026-07-27

## Goal

Adopt the code organization and development harness of
[`actions/typescript-action`](https://github.com/actions/typescript-action) while preserving
this action's business logic — Yandex Cloud Serverless Function deployment — unchanged in
observable behavior.

"Behavior" here means the gRPC/HTTP requests the action issues and the outputs and job
summary it produces. Any change to those is a regression, not a refactor.

## Decisions

| Question | Decision |
| --- | --- |
| Module system / bundler | Full ESM + Rollup, matching the template. ncc is the documented fallback. |
| `src/` layout | Split the 409-line `main.ts` into focused modules; keep `src/parse/` and `src/storage/`. |
| Test doubles and data | Full template convention: `__fixtures__/` for doubles and data, `__tests__/` for `*.test.ts` only. |
| Scaffolding | Core scripts + `.node-version` + `ci.yml` + `check-dist.yml`; coverage badge and threshold; linter workflow and configs; `local-action` + `.env.example` + `.vscode/`. |
| Prettier | Keep this repo's values (120 columns, 4-space indent, `arrowParens: avoid`) in the template's `.prettierrc.yml` file format. |
| Node version | `using: node24` in `action.yml`, `.node-version` 24.x, `engines.node >=24`. |
| Behavior verification | Characterization snapshots captured on `main` first, plus a real deploy smoke test before merge. |

The Prettier decision is deliberate divergence from the template: 120 columns suits the long
Yandex SDK type names and deep import paths, and keeping the current width limits the diff to
lines that actually changed.

The Node decision is breaking-ish. `node24` is GA on GitHub-hosted runners, but consumers on
older self-hosted runners or GHES without the `node24` runtime will break. This warrants a
major version bump and a changelog note.

## Findings that shape the work

Two facts were verified against the installed dependency tree before designing.

**The Yandex SDK's `exports` map covers the deep imports.**
`@yandex-cloud/nodejs-sdk@3.2.0` declares `"./dist/*": "./dist/*.js"` among its 196 export
keys, and every deep path this repo imports has a sibling `.d.ts`:

- `dist/types`
- `dist/token-service/iam-token-service`
- `dist/generated/yandex/cloud/{iam/v1,lockbox/v1,logging/v1,operation,serverless/functions/v1}/*`

So `moduleResolution: NodeNext` resolves them without rewriting a single SDK specifier. Only
*relative* imports need `.js` appended. The wildcard subpath exports (`./lockbox-v1/*`,
`./serverless-functions-v1/*`, `./operation/*`) also resolve, including
`@yandex-cloud/nodejs-sdk/operation/operation`.

**`@grpc/grpc-js` reads `.proto` files at runtime.**
`build/src/channelz.js` and `build/src/orca.js` call
`` loaderLoadSync('channelz.proto', { includeDirs: [`${__dirname}/../../proto`] }) ``. That is
why the current ncc `dist/` contains `proto/`, `xds/`, and `protoc-gen-validate/`.

Both call sites are lazy. `channelz.setup()` runs at import time but only *registers*
`getChannelzServiceDefinition` as a callback; the proto load fires when an admin service is
actually served. `orca.js` loads only under xds. A client-only action reaches neither. But
`__dirname` is undefined in a Rollup ESM bundle, so if either path were reached it would raise
`ReferenceError` rather than working.

**Copying the protos to `dist/proto/` cannot restore parity.** With `__dirname` shimmed to the
real `dist/`, `${__dirname}/../../proto` resolves *above* the action checkout — for an action
installed at `_actions/yc-actions/yc-sls-function/v5/`, it points at
`_actions/yc-actions/yc-sls-function/proto`, a sibling of the version directory that is not part
of any checkout. Making it land inside `dist/` would mean pointing `__dirname` at a fabricated
path such as `dist/node_modules/@grpc/grpc-js/build/src`, which breaks `__dirname` for every
other consumer in the bundle.

So the design shims `__dirname` honestly and does **not** ship the `.proto` files. With the shim
in place, the failure mode if either path were ever reached is a clear `ENOENT` on a real path
rather than a `ReferenceError`. The real-deploy verification is the check on this reasoning.

## Architecture

### Target layout

```
.node-version                 24.x
action.yml                    using: node24  (inputs/outputs unchanged)
rollup.config.ts              ESM bundle + __dirname shim + proto asset copy
tsconfig.json                 NodeNext, include: [src]
jest.config.js                ESM preset, ts-jest-resolver, coverage
eslint.config.mjs             FlatCompat + @typescript-eslint + jest + prettier
.prettierrc.yml               120 / 4 / arrowParens: avoid
.env.example                  every action input, for npm run local-action
badges/coverage.svg
.vscode/                      extensions.json, launch.json, merged settings.json
src/
  index.ts                    entrypoint: run()
  main.ts                     thin: auth -> inputs -> orchestrate
  action-inputs.ts            ActionInputs type + readInputs()
  auth.ts                     WIF token exchange (logic unchanged)
  function/
    create.ts                 getOrCreateFunctionId
    version.ts                createFunctionVersion
  lockbox.ts                  resolveLatestLockboxVersions
  upload.ts                   uploadToS3
  service-account.ts          logic unchanged
  async-invocation.ts         logic unchanged
  summary.ts                  logic unchanged
  zip.ts                      logic unchanged
  parse/                      logic unchanged (7 modules + index)
  storage/                    index.ts, storage-object.ts
__fixtures__/
  core.ts  github.ts  axios.ts  storage.ts
  yandex-sdk/{index,iam-v1,lockbox-v1,logging-v1,serverless-functions-v1}.ts
  workspace/                  zip test data
__tests__/                    *.test.ts only + __snapshots__/
```

Deleted: `lib/` (untracked `tsc` output that nothing consumes), `.github/linters/` (stale
copies from an older template revision), `__tests__/tsconfig.json`,
`__tests__/.eslintrc.json`, `src/storage/__mocks__/`, `.github/workflows/test.yml`.

Untouched: `adr/`, `CHANGELOG.md`, `.mergify.yml`, `.github/ISSUE_TEMPLATE/`,
`.github/dependabot.yml`, `README.md` prose, `action.yml` inputs and outputs.

`.vscode/` currently exists but is untracked, and holds personal
`workbench.colorCustomizations`. The template's `extensions.json` and `launch.json` are added
as-is; `settings.json` is *merged* so the existing color block survives alongside the
template's Copilot instruction keys. `mcp.json` is skipped — it configures MCP servers
unrelated to this action. Committing `.vscode/` is itself a change from the current state.

### Module split

`main.ts` currently mixes `run()` orchestration with four business functions. Each moves out
with its logic intact:

| Function | Moves to | Depends on |
| --- | --- | --- |
| `getOrCreateFunctionId` | `src/function/create.ts` | `Session`, `functionService`, `@actions/github` context |
| `createFunctionVersion` | `src/function/version.ts` | `Session`, `parse/*`, `service-account`, `async-invocation`, `lockbox` |
| `resolveLatestLockboxVersions` | `src/lockbox.ts` | `Session`, `secretService` |
| `uploadToS3` | `src/upload.ts` | `StorageServiceImpl`, `StorageObject` |

Input reading moves from the inline object literal in `run()` to `readInputs()` in
`action-inputs.ts`, next to the `ActionInputs` type it produces. After the split, `main.ts`
holds only: credential selection (SA JSON, then IAM token, then WIF), `readInputs()`, the
zip/create/upload/version sequence, error handling, and the `finally` block that writes the
summary.

Each new module has one reason to exist, one exported function, and can be tested against a
mocked `Session` without constructing the whole action.

### ESM migration

`package.json` gains `"type": "module"` and `"exports": { ".": "./dist/index.js" }`, drops
`"main"`, and sets `"engines": { "node": ">=24.0.0" }`. `name`, `version`, `repository`, and
the `git-tag` script are preserved — release tagging reads `version` from this file.

`tsconfig.json` switches to `module: NodeNext` / `moduleResolution: NodeNext`, adds
`noUnusedLocals`, sets `outDir: ./dist`, and uses `include: ["src"]` with `__fixtures__`,
`__tests__`, `coverage`, `dist`, `node_modules` excluded.

Every relative import gains a `.js` extension (`./main` becomes `./main.js`). Bare specifiers
and Yandex SDK deep specifiers are left alone.

`dist/index.js` becomes ESM. The action's own `package.json` marks the directory
`type: module`, which is how the template ships and how the Actions runner loads it.

### Bundling

Rollup as in the template, plus one addition the template does not need: an `output.banner` that
defines `require`, `__filename`, and `__dirname` from `import.meta.url`. The CommonJS
dependencies in this graph (`@yandex-cloud/nodejs-sdk`, `@grpc/grpc-js`, `archiver`) reference
all three, and none exist in an ES module.

Dropped from `dist/`: `licenses.txt` and `sourcemap-register.js` (ncc-specific — Rollup emits
`index.js` and `index.js.map`), and the `proto/`, `xds/`, and `protoc-gen-validate/` trees, for
the reason given under Findings.

## Test harness

`jest.config.js` is the template's: `preset: ts-jest`, `extensionsToTreatAsEsm: ['.ts']`,
`resolver: ts-jest-resolver`, `useESM: true`, `tsconfig: 'tsconfig.json'`,
`collectCoverageFrom: ['./src/**']`, reporters `json-summary`, `text`, `lcov`. The `test`
script sets `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1` and
`GITHUB_WORKSPACE=__fixtures__/workspace`.

Under ESM, `jest.mock` and `__mocks__` directory auto-resolution do not work. Every test file
becomes: `jest.unstable_mockModule(...)` declarations for each dependency, then
`const { run } = await import('../src/main.js')`.

The six existing hand-written SDK mocks port to `__fixtures__/yandex-sdk/*.ts` keeping their
`__setFunctionList`, `__setCreateFunctionFail`, `__setCreateVersionFail`, `__setVersionList`,
`__setServiceAccountList`, and `__setLockboxVersions` control surface. That control surface
encodes the test scenarios, so it moves mechanically rather than being redesigned.

Two details the template does not cover:

- ESLint's `parserOptions.projectService.allowDefaultProject` must include
  `__fixtures__/**/*.ts` — the template lists only one directory level, and
  `__fixtures__/yandex-sdk/` is nested.
- `unstable_mockModule` matches on the exact specifier string the module under test imports.
  `@yandex-cloud/nodejs-sdk/serverless-functions-v1` and
  `@yandex-cloud/nodejs-sdk/dist/generated/.../function_service` are separate registrations
  even though they resolve into the same package.

The eight existing test files keep their names. `__tests__/foo/` and `__tests__/src/` move to
`__fixtures__/workspace/`; the `zip-sources` snapshot moves with them and its recorded paths
update accordingly.

### Coverage threshold

Measured on the current code: lines 54.46%, statements 55.55%, functions 48.48%, branches
45.09%. The threshold is a ratchet just below those — lines 50, statements 50, functions 45,
branches 42 — not the template's commented-out 100%. CI then blocks regressions without
failing on day one.

The ratchet is *committed last*, after the rewrite, and validated against the post-rewrite
measurement. Splitting `main.ts` changes the denominator: the same tests spread over more files
can move each percentage in either direction. If a metric lands below its floor, the fix is to
add the missing test, not to lower the floor — the pre-rewrite numbers above are the contract.

## Verification

The tests that protect the business logic are themselves being rewritten, so they cannot serve
as their own regression net. The net is built first, on `main`.

**Stage 0 — characterization snapshot, committed to `main` before any rewrite.**

One test against the *current* code. The SDK mock records every request object it receives —
`ListFunctionsRequest`, `CreateFunctionRequest`, `CreateFunctionVersionRequest`, and the S3
`putObject` arguments — across each input scenario `main.test.ts` already covers: defaults,
async enabled, secrets, mounts, log options, bucket versus inline upload, and each of the three
credential paths (SA JSON, IAM token, WIF).

The recording is serialized to a committed JSON snapshot through a stable normalizer:

- `Buffer` and `Uint8Array` become `sha256:<hex>` — zip bytes are not reproducible across runs,
  but their digest is, given fixed input files.
- `Long` becomes a decimal string.
- Object keys are sorted.

The snapshot file is plain JSON and therefore harness-agnostic. That is what lets it survive
the swap from `jest.mock` to `unstable_mockModule`: the assertion mechanism changes, the
recorded contract does not.

**The rewrite** follows on a branch, broken into stages by the implementation plan. Whatever
the staging, the gate is the same: the ported fixture records the same way and must reproduce
the Stage 0 snapshot byte-identically. Any diff is a behavior change to explain or fix.

**Bundle smoke test**, a `ci.yml` job: `node dist/index.js` with no credentials must exit
non-zero with `No credentials`. This proves the ESM bundle loads and the grpc-js and archiver
module graphs initialize — something unit tests against mocks cannot show.

**Real deploy**, before merge: deploy the same function to a scratch folder from `main` and
from the branch, then diff the resulting function version configuration. This requires a folder
ID and credentials, to be supplied at that point.

## CI

- `ci.yml` — `format:check`, `lint`, `ci-test`, `coverage`, plus the bundle smoke-test job.
  The template's `test-action` job (which runs the action against itself) is replaced by the
  smoke test, because running this action for real needs Yandex Cloud credentials.
- `check-dist.yml` — the template's version, which runs `npm run bundle` and diffs `dist/`.
  This fixes a live bug: the current workflow runs `npm run build` (`tsc`, which writes `lib/`)
  and then diffs `dist/`, so it cannot detect a stale bundle.
- `linter.yml` — super-linter, with root `.markdown-lint.yml`, `.yaml-lint.yml`, and
  `actionlint.yml` replacing the stale `.github/linters/` copies.
- `test.yml` — deleted, superseded by `ci.yml`.
- `dependabot.yml` and `.mergify.yml` — unchanged.

### npm scripts

Template set: `bundle`, `package`, `package:watch`, `format:write`, `format:check`, `lint`,
`test`, `ci-test`, `coverage`, `local-action`, `all`. `build` (bare `tsc`) is removed along
with `lib/`.

`git-tag` is kept and the template's `script/release` is *not* adopted. They are not
equivalent: `git-tag` force-moves both the floating major tag (`vN`) and the exact version tag
(`vN.M.P`), which is the release convention for a published action, while `script/release`
prompts for a version and pushes a single tag. Adding both would give the repo two
contradictory release paths.

## Out of scope

Not brought over from the template: `licensed.yml` and `.licenses/` (needs the Ruby `licensed`
gem, and the grpc dependency tree makes it heavy), `codeql-analysis.yml`, `.checkov.yml`,
`.devcontainer/`, `CODEOWNERS`, `.github/copilot-instructions.md`, `.github/prompts/`,
`.vscode/mcp.json`, and `script/release` (see npm scripts above for why).

Not changed: `action.yml` inputs and outputs, README prose, `adr/`, and the business logic
itself.

## Risks

**Rollup bundling `@grpc/grpc-js` is the one unproven step.** It is exercised at stage 1 and
gated by the smoke test. If Rollup cannot produce a loadable bundle, the fallback is to revert
`package` to ncc and ship the CJS output behind a `dist/package.json` containing
`{"type":"commonjs"}`. The ESM source layout and the test harness stand either way — only the
`package` script changes.

**`archiver` uses lazy `require` internally**, which `@rollup/plugin-commonjs` hoists. If a
transitive dynamic require resists bundling, the options are to externalize those modules and
ship them alongside `dist/`, or take the ncc fallback.

**`node24` is a consumer-visible change.** Runners without the `node24` runtime will fail to
start the action. Needs a major version bump and a changelog entry.
