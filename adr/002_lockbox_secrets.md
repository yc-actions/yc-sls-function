# Architecture Decision Record: Lockbox Secrets for Yandex Cloud Serverless Functions

## Context

Yandex Cloud Serverless Functions can securely access sensitive data like API keys, database passwords, and other credentials using Yandex Lockbox. This feature allows secrets to be managed centrally and securely, and then injected into the function's environment at runtime as environment variables. This avoids hardcoding secrets in source code, which is a security best practice.

This ADR outlines the approach for integrating Lockbox secrets into the `yc-sls-function` GitHub Action.

## Goals

- Allow users to specify Lockbox secrets in the GitHub Action inputs.
- Pass the secret configuration to the Yandex Cloud API when creating function versions.
- Support a mechanism to automatically use the latest version of a secret.
- Provide clear documentation and usage examples.

## Constraints

- The solution must be backward-compatible; existing workflows without secrets must continue to work without modification.
- The syntax for defining secrets should be clear, concise, and easy to use.
- The action should handle errors gracefully, such as when a secret or version cannot be found.

## High-Level Design

1. **Input Configuration**: The action's configuration in `action.yml` will be extended to accept a multi-line `secrets` input.
2. **Parsing**: A dedicated parser will process the `secrets` input string. Each line will represent a single secret and its mapping to an environment variable. The parser will be located in `src/parse/lockboxVariables.ts`.
3. **'Latest' Version Resolution**: A helper function, `resolveLatestLockboxVersions`, will be implemented in `src/main.ts`. This function will query the Lockbox API to resolve the `latest` tag to a specific version ID for any secrets that use it.
4. **API Request**: The resolved secrets will be included in the `CreateFunctionVersionRequest` sent to the Yandex Cloud API.
5. **Documentation & Testing**: The `README.md` will be updated to document the new feature, and comprehensive unit tests will be added for the parsing and version resolution logic.

## Secrets Input Syntax

Each line in the `secrets` input must follow this format:

```
<environment-variable>=<secret-id>/<version-id>/<key>
```

- `environment-variable` (required): The name of the environment variable that the secret's value will be assigned to within the function.
- `secret-id` (required): The unique identifier of the secret in Lockbox.
- `version-id` (required): The identifier of the secret's version. The special value `latest` can be used to automatically select the most recent version.
- `key` (required): The key of the specific value within the secret version.

### Examples

```
# Using a specific version ID
API_KEY=e6q8f2j8b3j9b3j9b3j9/e6q9f2j8b3j9b3j9b3j9/api-key

# Automatically using the latest version
DB_PASSWORD=e6q8f2j8b3j9b3j9b3j9/latest/db-password
```

## Implementation Plan

1. **Update Action Inputs**:
    - Add a `secrets` input to `action.yml` (type: multiline, optional).
    - Update the `ActionInputs` type in `src/actionInputs.ts` to include `secrets: string[]`.

2. **Implement Parser**:
    - Create `parseLockboxVariables` in `src/parse/lockbox-variables.ts`.
    - This function will take an array of strings (from the input) and return an array of structured `Secret` objects (`{ environmentVariable, id, versionId, key }`).
    - It must include validation to ensure each line is correctly formatted.

3. **Implement 'latest' Version Resolution**:
    - Create the `resolveLatestLockboxVersions` async function in `src/main.ts`.
    - For each secret with `versionId === 'latest'`, this function will use the `secretService.get` method from the Yandex Cloud SDK to fetch the secret's details and find the ID of the `currentVersion`.
    - It will return a new list of secrets with all `latest` tags replaced by concrete version IDs.

4. **Integrate into API Call**:
    - In `createFunctionVersion` within `src/main.ts`, call `resolveLatestLockboxVersions` before building the `CreateFunctionVersionRequest`.
    - Assign the resolved secrets to the `secrets` property of the request object.

5. **Testing**:
    - Add unit tests for `parseLockboxVariables` to cover valid and invalid input formats.
    - Add unit tests for `resolveLatestLockboxVersions`, using mocks for the Lockbox SDK client to simulate API responses.

6. **Documentation**:
    - Update `README.md` with a section explaining how to use the `secrets` input, including examples.
    - Create this ADR file (`adr/002_lockbox_secrets.md`).

## Example Usage (in a workflow file)

```yaml
- name: Deploy Function with Lockbox Secrets
  uses: yc-actions/yc-sls-function@v4
  with:
    # ... other inputs
    secrets: |
      API_KEY=e6q8f2j8b3j9b3j9b3j9/e6q9f2j8b3j9b3j9b3j9/api-key
      DB_PASSWORD=e6q8f2j8b3j9b3j9b3j9/latest/db-password
```

## Open Questions

- How should the action behave if a secret ID or version ID (when not `latest`) is not found?
  - *Decision*: The Yandex Cloud API will reject the request. The action should fail with the error message from the API. For `latest` resolution, if a secret is not found, the action will fail early with a clear error message.
- Are there other version aliases to consider besides `latest`?
  - *Decision*: For now, only `latest` will be supported as a special alias. Other aliases can be added in the future if required.
