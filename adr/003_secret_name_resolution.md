# Architecture Decision Record: Name-Based Secret Resolution for Lockbox Secrets

## Context

ADR 002 introduced the `secrets` input, where each line takes the form `<ENV_VAR>=<secret-id>/<version-id>/<key>`. The
`<secret-id>` position accepts only a Lockbox secret ID — an opaque string such as `e6q8f2j8b3j9b3j9b3j9`. Those IDs are
hard to read in a workflow file, hard to review in a diff, and change whenever a secret is recreated, which forces an
edit to every workflow that references it.

Users have asked to reference secrets by their human-readable name instead. This ADR describes a two-stage resolution
mechanism that accepts either an ID or a name in the same position.

## Goals

- Accept a Lockbox secret name wherever a secret ID is accepted today.
- Keep every existing ID-based workflow working unchanged, with unchanged IAM requirements.
- Prefer ID-based lookup, so the common case needs no extra permission and no extra API call.
- Report every unresolvable secret in one error rather than failing on the first.

## Constraints

- Names and IDs are not distinguishable by shape. Yandex Cloud does not guarantee an ID format the action can pattern
  match on, so the action cannot decide up front which kind of reference it was given.
- Listing secrets requires `lockbox.viewer`; reading one by ID requires only `lockbox.payloadViewer`. Requiring the
  broader role unconditionally would be a breaking change for existing users.
- Secret names are unique within a folder, so a folder listing is enough to resolve a name.
- Only references using `latest` are resolved by the action; a reference pinned to an explicit version is passed to the
  API untouched and therefore cannot use a name.

## High-Level Design

`resolveLatestLockboxVersions` in `src/lockbox.ts` resolves in two stages.

1. **ID lookup (primary).** Every reference with `versionId === 'latest'` is looked up with `SecretService.Get`, at most
   five calls in flight. A successful lookup yields the current version ID. A rejected lookup is not treated as an error
   — the reference is marked `fallback`, because the value may be a name.
2. **Name lookup (fallback).** Only if at least one reference fell back, the folder is listed once with
   `SecretService.List`, paging through `nextPageToken`, and indexed by secret name. Each fallback reference is matched
   against that index; a match rewrites both the secret ID and the version ID.

A reference that survives both stages unresolved is neither a readable ID nor a name in the folder, and is reported as
an error.

### Resolution result

Each reference carries a tagged result through the two stages:

```typescript
type ResolutionResult =
    | { status: 'success'; secret: Secret } // resolved, ID and version final
    | { status: 'fallback'; original: Secret } // Get failed, try name lookup
    | { status: 'error'; error: Error } // resolved but unusable
```

`fallback` is what makes the second stage conditional: no fallbacks means no `List` call and no `lockbox.viewer`
requirement.

### Why not detect names up front

Deciding "this looks like an ID, that looks like a name" from the string alone would couple the action to an
undocumented ID format. Attempting `Get` first is authoritative: Lockbox itself decides whether the value is a usable
ID. The cost is one rejected call per name-based reference, which is paid only by workflows that use names.

### Ordering and shape

The function returns an array positionally identical to its input. References pinned to an explicit version are returned
as the same objects. This keeps the `CreateFunctionVersionRequest` payload stable, which the characterization snapshots
in `__tests__/characterization.test.ts` assert on.

### Concurrency

ID lookups run through a local bounded-concurrency helper (`mapWithConcurrency`) rather than a dependency such as
`@supercharge/promise-pool`. The helper is a dozen lines, preserves input order, and keeps the bundled action free of an
extra runtime dependency.

## IAM Permission Requirements

| Role                    | Grants                      | Needed when                              |
| ----------------------- | --------------------------- | ---------------------------------------- |
| `lockbox.payloadViewer` | Read a secret payload by ID | Always                                   |
| `lockbox.viewer`        | List secrets in a folder    | Only when a secret is referenced by name |

Existing ID-based workflows keep working with `lockbox.payloadViewer` alone. A workflow that references any secret by
name must additionally grant `lockbox.viewer` on the folder.

## Error Handling

Failures from both stages are collected and thrown together:

```txt
Failed to resolve latest versions for secrets: <message>, <message>
```

The individual messages are:

- `Failed to resolve secret: <reference>` — neither a readable ID nor a name in the folder.
- `Secret <id> has no current version` — found by ID, but the secret has no versions.
- `Secret <reference> (found as <id>) has no current version` — found by name, but the secret has no versions.

Reporting all failures at once matters here: a workflow typically declares several secrets, and fixing them one
deployment at a time is slow.

## Testing

`__tests__/lockbox.test.ts` covers the resolution logic against the SDK mock in `__fixtures__/yandex-sdk/lockbox-v1.ts`:

- Passthrough when no reference uses `latest` — asserts neither `Get` nor `List` is called.
- Resolution by ID, including several references to the same secret.
- Order preservation across a mix of `latest` and pinned references.
- Fallback to name, including the ID rewrite.
- Paging through `nextPageToken` during the folder listing.
- A single run mixing an ID-resolved and a name-resolved reference.
- One `List` call for a batch of fallbacks.
- Both "no current version" errors, and the combined message for several unresolvable references.
- More references than the concurrency limit.

The mock gained `__setSecretList`, `__setGetSecretFail`, `__setUnknownSecretIds` and `__setListPageSize` to drive these
paths. `__setUnknownSecretIds` makes `Get` fail for named ids only, which is what exercises the mixed case.

## Consequences

### Positive

- Workflows can reference secrets by name, and survive a secret being recreated.
- No change for existing users: same input format, same IAM roles, same API calls.
- The folder listing is lazy, so the cost is paid only by workflows that use names.

### Negative

- Name-based references require the broader `lockbox.viewer` role.
- Each name-based reference costs one rejected `Get` before the listing.
- A typo in a secret ID now produces "failed to resolve" only after the folder listing, rather than immediately.

### Neutral

- Only `latest` references can use a name. A reference pinned to an explicit version is not resolved by the action and
  must therefore still use an ID.

## Related ADRs

- **ADR 002**: Lockbox Secrets — the `secrets` input and `latest` version resolution this builds on.
