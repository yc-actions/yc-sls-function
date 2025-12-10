# Architecture Decision Record: Name-Based Secret Resolution for Lockbox Secrets

## Context

Building upon ADR 002 (Lockbox Secrets), users currently specify Lockbox secrets using their unique IDs in the format `<ENV_VAR>=<secret-id>/<version-id>/<key>`. While this works reliably, secret IDs are cryptic alphanumeric strings (e.g., `e6q8f2j8b3j9b3j9b3j9`) that are difficult to remember and manage. Users have requested the ability to reference secrets by their human-readable names instead of IDs for better usability and maintainability.

This ADR describes the implementation of a two-stage secret resolution mechanism that allows users to reference secrets by either ID or name, with automatic fallback from ID to name-based lookup.

## Goals

- Allow users to reference Lockbox secrets by their human-readable names in addition to IDs
- Maintain full backward compatibility with existing ID-based references
- Provide clear error messages when secrets cannot be resolved
- Optimize performance by attempting ID-based lookup first (faster, requires fewer permissions)
- Document the IAM permission differences between ID-based and name-based resolution

## Constraints

- Must remain backward compatible; existing workflows using secret IDs must continue to work unchanged
- ID-based resolution should be preferred to minimize permission requirements
- Name-based fallback requires broader IAM permissions (`lockbox.viewer` vs `lockbox.payloadViewer`)
- Must handle large numbers of secrets efficiently (pagination support)
- Error messages must clearly indicate which secrets failed to resolve

## High-Level Design

### Two-Stage Resolution Approach

The `resolveLatestLockboxVersions` function implements a two-stage resolution strategy:

1. **Stage 1 - ID-Based Resolution** (Primary Path):
   - Attempts to resolve secrets by treating the `id` field as a Lockbox secret ID
   - Uses `secretService.get({ secretId })` API call
   - Runs concurrently with PromisePool (concurrency: 5) for performance
   - Requires only `lockbox.payloadViewer` permission
   - Backward compatible with existing workflows

2. **Stage 2 - Name-Based Resolution** (Fallback Path):
   - Triggered only when Stage 1 fails for one or more secrets
   - Lists all secrets in the folder using `secretService.list({ folderId })`
   - Matches secrets by name (treating the original `id` field as a name)
   - Supports pagination for folders with many secrets
   - Requires `lockbox.viewer` permission (includes list operation)

### Resolution Result Tracking

A typed result system tracks the status of each secret resolution:

```typescript
type ResolutionResult =
    | { status: 'success'; secret: Secret }    // Successfully resolved
    | { status: 'fallback'; original: Secret } // Needs name-based lookup
    | { status: 'error'; error: Error }        // Resolution failed
```

### Helper Functions

Three new helper functions support the resolution process:

1. **`resolveSecretsById`**:
   - Attempts parallel ID-based resolution for all secrets with `versionId === 'latest'`
   - Returns array of `ResolutionResult` objects
   - Catches failures silently to enable fallback

2. **`findSecretsInFolder`**:
   - Lists all secrets in the specified folder with pagination support
   - Returns `Map<string, LockboxSecret>` keyed by secret name
   - Handles `nextPageToken` for folders with >100 secrets

3. **`resolveLatestLockboxVersions`** (refactored):
   - Orchestrates the two-stage resolution process
   - Filters secrets that need resolution (`versionId === 'latest'`)
   - Attempts Stage 1, then Stage 2 for fallback cases
   - Collects and reports all resolution errors
   - Returns updated secrets array with resolved version IDs

## Implementation Details

### Changes to `src/main.ts`

**New Imports**:

```typescript
import {
    ListSecretsRequest,
    ListSecretsResponse
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret_service'
import { Secret as LockboxSecret } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'
import { PromisePool } from '@supercharge/promise-pool'
```

**Function Signature Change**:

```typescript
// Before
async function resolveLatestLockboxVersions(session: Session, secrets: Secret[]): Promise<Secret[]>

// After
export async function resolveLatestLockboxVersions(
    session: Session,
    folderId: string,
    secrets: Secret[]
): Promise<Secret[]>
```

**Call Site Update**:

```typescript
// Before
secrets = await resolveLatestLockboxVersions(session, secrets)

// After
secrets = await resolveLatestLockboxVersions(session, inputs.folderId, secrets)
```

### Changes to Test Infrastructure

**Mock Enhancements** (`__tests__/__mocks__/@yandex-cloud/nodejs-sdk/lockbox-v1.ts`):

- Added `secrets` array for storing mock secret metadata
- Added `__setSecretList(value: Secret[])` helper for configuring test data
- Added `__setGetSecretFail(value: boolean)` helper for simulating ID lookup failures
- Implemented `list()` method to support folder-level secret listing in tests

**New Test Suite** (`__tests__/lockbox-secrets.test.ts`):

- 7 comprehensive tests covering all resolution scenarios
- Tests for ID-based resolution (happy path)
- Tests for name-based fallback (when ID fails)
- Tests for error handling (missing secrets, no current version)
- Tests for mixed scenarios (some latest, some explicit versions)
- Tests for duplicate keys (same secret ID, different keys)

## IAM Permission Requirements

The feature introduces conditional permission requirements based on usage pattern:

| Permission               | Required For                              | When Needed                          |
|--------------------------|-------------------------------------------|--------------------------------------|
| `lockbox.payloadViewer`  | Access secrets by ID (basic access)       | Always (minimum requirement)         |
| `lockbox.viewer`         | Access secrets by name (includes list)    | Only when referencing secrets by name|

### Backward Compatibility

- Existing workflows using secret IDs require only `lockbox.payloadViewer` (no change)
- New workflows using secret names require `lockbox.viewer` (broader permission)
- The two-stage approach ensures ID-based resolution attempts first, even if the value is actually a name

## Usage Examples

### Using Secret IDs (Existing Behavior)

```yaml
secrets: |
  DB_PASSWORD=e6q8f2j8b3j9b3j9b3j9/latest/password
  API_KEY=abc123def456/latest/api-key
```

**Requires**: `lockbox.payloadViewer` permission

### Using Secret Names (New Feature)

```yaml
secrets: |
  DB_PASSWORD=my-database-credentials/latest/password
  API_KEY=external-api-keys/latest/api-key
```

**Requires**: `lockbox.viewer` permission

### Mixed Approach

```yaml
secrets: |
  DB_PASSWORD=e6q8f2j8b3j9b3j9b3j9/latest/password    # ID-based
  API_KEY=external-api-keys/latest/api-key            # Name-based
  CACHE_URL=redis-config/v123/connection-string       # Name-based, specific version
```

**Requires**: `lockbox.viewer` permission (due to name-based references)

## Performance Considerations

1. **Concurrent ID Resolution**: Uses PromisePool with concurrency of 5 to resolve multiple secrets in parallel
2. **Lazy Folder Listing**: Only lists folder secrets when ID resolution fails (fallback case)
3. **Pagination Support**: Handles folders with >100 secrets using `nextPageToken`
4. **Early Exit**: Returns immediately if no secrets need resolution (`versionId !== 'latest'`)

## Error Handling

The implementation provides clear, actionable error messages:

- **Secret not found**: `"Failed to resolve secret: secret-name"`
- **No current version**: `"Secret secret-id has no current version"`
- **Multiple failures**: `"Failed to resolve latest versions for secrets: error1, error2, error3"`

Errors are collected and reported together, showing all failed secrets in a single message.

## Testing Strategy

### Unit Tests

- Test ID-based resolution success path
- Test name-based fallback when ID fails
- Test error handling for missing secrets
- Test secrets without current version
- Test mixed resolution scenarios
- Test pagination handling (via mock)

### Integration Tests

- Existing integration test updated to pass `folderId` parameter
- Validates full workflow with "latest" version resolution

### Test Coverage

- 7 new unit tests in dedicated test file
- All existing tests still pass (92 total tests)
- Mock infrastructure supports both resolution paths

## Migration Path

### For Existing Users

No action required. Existing workflows using secret IDs continue to work with `lockbox.payloadViewer` permission.

### For New Users Wanting Name-Based Resolution

1. Grant `lockbox.viewer` role to the service account (instead of `lockbox.payloadViewer`)
2. Reference secrets by their human-readable names in the `secrets` input
3. Deploy as usual

### Gradual Migration

Users can migrate incrementally:

1. Grant `lockbox.viewer` role to service account
2. Replace secret IDs with names one at a time
3. Existing ID-based references continue to work during migration

## Documentation Updates

### README.md Changes

- Updated "Runtime permissions" section to clarify when each role is required
- Added explanation that `lockbox.payloadViewer` is sufficient for ID-based access
- Added note that `lockbox.viewer` is needed for name-based access
- Maintained existing examples showing both formats

### This ADR

- Documents the rationale, design, and implementation of the feature
- Provides clear migration guidance
- Explains performance and security considerations

## Future Enhancements

Potential future improvements not included in this implementation:

1. **Caching**: Cache folder secret listings to avoid repeated API calls in the same deployment
2. **Pattern Matching**: Support wildcards or regex in secret names
3. **Secret Validation**: Verify that requested keys exist in the secret before deployment
4. **Metrics**: Log metrics about resolution method distribution (ID vs name)

## Related ADRs

- **ADR 002**: Lockbox Secrets - Initial implementation of Lockbox secret support with "latest" version resolution
- **ADR 001**: Object Storage Mounts - Pattern for multiline input parsing

## Decision

**Accepted**: Implement two-stage secret resolution with ID-based primary path and name-based fallback.

This approach provides the best balance of:

- Usability (human-readable names)
- Backward compatibility (existing IDs work unchanged)
- Performance (ID lookup first)
- Security (minimal permissions for existing workflows)
- Clarity (clear error messages)

## Consequences

### Positive

- ✅ Users can now use human-readable secret names
- ✅ Full backward compatibility maintained
- ✅ Existing workflows require no changes
- ✅ Clear documentation of permission requirements
- ✅ Comprehensive test coverage
- ✅ Performance optimized with concurrent resolution

### Negative

- ⚠️ Name-based resolution requires broader IAM permissions
- ⚠️ Slightly more complex implementation (two resolution paths)
- ⚠️ Additional API calls when using name-based references (list operation)

### Neutral

- ℹ️ Function exported for testing (may be useful for other purposes)
- ℹ️ Adds dependency on PromisePool (already used elsewhere in codebase)
- ℹ️ Requires understanding of two resolution methods in documentation
