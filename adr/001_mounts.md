# Architecture Decision Record: Object Storage Mounts for Yandex Cloud Serverless Functions

## Context

Yandex Cloud Serverless Functions recently introduced support for mounting Object Storage buckets directly into the function's filesystem. This feature allows functions to access bucket contents as files, improving performance and simplifying code that needs to read large or many files. Issue [#595](https://github.com/yc-actions/yc-sls-function/issues/595) requests support for this feature in the GitHub Action.

## Goals

- Allow users to specify Object Storage mounts in the GitHub Action inputs.
- Pass mount configuration to the Yandex Cloud API when creating function versions.
- Support all mount options available in the Yandex Cloud API/SDK.
- Provide clear documentation and usage examples.

## Constraints

- Must be backward compatible (existing workflows must not break).
- Only available for runtimes and regions supported by Yandex Cloud.
- Requires recent version of the Yandex Cloud Node.js SDK (ensure compatibility).

## High-Level Design

- Extend `ActionInputs` and `action.yml` to accept a new `mounts` input (multiline, short syntax similar to Docker Compose).
- Parse and validate the `mounts` input in `src/main.ts`.
- When creating a function version, add the `mounts` field to the `CreateFunctionVersionRequest` if provided.
- Add tests and update documentation.

## Mounts Input Syntax

**Short syntax (preferred, similar to Docker Compose):**

Each line in the `mounts` input should be in the form:

```txt
<mount-point>:<bucket>[/<prefix>][:ro]
```

- `mount-point` (required): Directory name to mount the bucket to (will be available as `/function/storage/<mount-point>`).
- `bucket` (required): Name of the Object Storage bucket.
- `prefix` (optional): Prefix within the bucket to mount (leave empty to mount the entire bucket).
- `ro` (optional): If present, mount is read-only. Otherwise, mount is read-write.

**Examples:**

```txt
data:my-bucket
images:my-bucket/photos
logs:my-bucket:ro
images:my-bucket/photos:ro
mount:bucket/prefix
mount:bucket/prefix:ro
```

## Implementation Plan

1. **Research SDK Support**
   - Confirm the latest `@yandex-cloud/nodejs-sdk` exposes the `mounts` field in `CreateFunctionVersionRequest`.
   - If not, update the SDK dependency.

2. **Update Action Inputs**
   - Add a new `mounts` input to `action.yml` (multiline, optional, short syntax as above).
   - Extend `ActionInputs` type in `src/action-inputs.ts` to include `mounts: string[]`.

3. **Parse and Validate Mounts**
   - In `src/main.ts`, parse each line of the `mounts` input into an object with fields: `mountPoint`, `bucket`, `prefix`, `readOnly`.
   - Validate required fields (mount-point, bucket name).
   - Convert to the structure expected by the SDK.

4. **Pass Mounts to API**
   - When building the `CreateFunctionVersionRequest`, add the `mounts` field if mounts are specified.
   - Ensure correct serialization and compatibility with the SDK/API.

5. **Testing**
   - Add unit tests for parsing and validation logic.
   - Add integration tests (mocked) to verify the mounts are passed to the API.

6. **Documentation**
   - Update `README.md` with usage examples for the new `mounts` input (short syntax).
   - Document limitations and links to Yandex Cloud docs.

7. **Release**
   - Bump version, update changelog, and release.

## Example Usage (to be documented)

```yaml
- name: Deploy Function with Object Storage Mount
  uses: yc-actions/yc-sls-function@v4
  with:
    mounts: |
      data:my-bucket
      images:my-bucket/photos
      logs:my-bucket:ro
      images:my-bucket/photos:ro
      mount:bucket/prefix
      mount:bucket/prefix:ro
```

## Open Questions

- Should we support both short and long syntax, or only short syntax?
- How to handle errors if the region/runtime does not support mounts?
