# Changelog

## 5.0.0

### Breaking

- The action now runs on the `node24` Actions runtime. Self-hosted runners and GHES installations without the `node24`
  runtime must upgrade their runner before using `v5`.

### Changed

- Repository restructured onto the `actions/typescript-action` template: ESM source bundled with Rollup, `__fixtures__`
  test doubles, and the template's CI workflows. No change to action inputs, outputs, or deployment behavior.
- `check-dist` now rebuilds the bundle it verifies. Previously it built `lib/` and compared `dist/`, so a stale
  `dist/index.js` could be merged.

## [4.1.0]

- Feature: Add support for Yandex Object Storage mounts via the new `mounts` input (short syntax, e.g.
  `<mount-point>:<bucket>[/<prefix>][:ro]`).
- The `mounts` input now maps to Mount[] objects (with name, mode, and objectStorage fields) in the API request.
- Documentation: Added usage examples and explanation for the mounts input in README.md.
- Refactor: Modularized all parse\* functions and improved test coverage for mount parsing.
