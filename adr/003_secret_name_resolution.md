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
- Resolution runs at deploy time, so both `Get` and `List` are issued by the credentials the action authenticates with
  (`yc-sa-json-credentials`, `yc-iam-token` or `yc-sa-id`) — not by the function's runtime `service-account`.
- Listing secrets requires `lockbox.viewer` on the folder, which is broader than the per-secret access an ID lookup
  needs. Requiring it unconditionally would be a breaking change for existing users.
- Secret names are unique within a folder, so a folder listing is enough to resolve a name.
- Only references using `latest` are resolved by the action; a reference pinned to an explicit version is passed to the
  API untouched and therefore cannot use a name.

## High-Level Design

`resolveLatestLockboxVersions` in `src/lockbox.ts` resolves in two stages.

References are first grouped by their `<secret-id>` value, so a secret read by several environment variables costs one
lookup and yields one outcome. Both stages then work per distinct reference.

1. **ID lookup (primary).** Every distinct reference among the `versionId === 'latest'` entries is looked up with
   `SecretService.Get`, at most five calls in flight. A successful lookup yields the current version ID. A rejected
   lookup is not treated as an error — the reference is marked `unknown`, because the value may be a name.
2. **Name lookup (fallback).** Only if at least one reference is `unknown`, the folder is listed with
   `SecretService.List`, paging through `nextPageToken` until every wanted name is found or the folder is exhausted.
   Each `unknown` reference is matched against that index; a match rewrites both the secret ID and the version ID.

A reference that survives both stages unresolved is neither a readable ID nor a name in the folder, and is reported as
an error.

### Lookup result

Each distinct reference carries a tagged result out of stage one:

```typescript
type IdLookup =
    | { status: 'found'; versionId: string } // resolved, version final
    | { status: 'no-version' } // real secret, but nothing to deploy
    | { status: 'unknown'; cause: string } // Get failed, try name lookup
```

`unknown` is what makes the second stage conditional: no unknown references means no `List` call and no `lockbox.viewer`
requirement.

`cause` carries the message Lockbox rejected the ID with. Stage one cannot tell "this is a name" from "the API was
briefly unavailable", so the reason has to survive into the final error — otherwise a transient failure is reported as a
nonexistent secret and sends the user looking in the wrong place.

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

Two different identities are involved, and conflating them is the easiest way to misconfigure this feature:

| Identity                                                                    | Role                    | Needed when                                         |
| --------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------- |
| Deploy credentials (`yc-sa-json-credentials` / `yc-iam-token` / `yc-sa-id`) | `lockbox.viewer`        | Resolving `latest`, and any reference given by name |
| Function `service-account`                                                  | `lockbox.payloadViewer` | Always — the function reads the payload at run time |

The name lookup adds `lockbox.viewer` on the folder for the **deploy** credentials only. Granting it to the function's
runtime service account has no effect on resolution. Existing ID-based workflows are unaffected: they issue the same
`Get` calls as before and never reach `List`.

## Error Handling

Per-reference failures from both stages are collected and thrown together, one message per secret:

```txt
Failed to resolve latest versions for secrets: <message>; <message>
```

The individual messages are:

- `secret "<reference>" is not a known id (<cause>) and no secret with that name exists in folder <folderId>` — neither
  a readable ID nor a name in the folder. `<cause>` is why the ID lookup failed.
- `Secret <id> has no current version` — found by ID, but the secret has no versions.
- `Secret <reference> (found as <id>) has no current version` — found by name, but the secret has no versions.

Reporting all failures at once matters here: a workflow typically declares several secrets, and fixing them one
deployment at a time is slow.

A failing `List` is different: it is not attributable to one reference, and it has one likely cause, so it throws on its
own with the fix in the message:

```txt
Failed to list secrets in folder <folderId> while resolving <n> secret(s) by name: <cause>. Grant lockbox.viewer on the
folder to the credentials the action authenticates with, or reference the secrets by id.
```

This path is reached by anyone who merely mistypes a secret ID, so naming the missing role — and the identity that needs
it — is what keeps a typo from reading as a permissions problem.

## Testing

`__tests__/lockbox.test.ts` covers the resolution logic against the SDK mock in `__fixtures__/yandex-sdk/lockbox-v1.ts`:

- Passthrough when no reference uses `latest` — asserts neither `Get` nor `List` is called.
- Resolution by ID, including one secret read by several keys — asserts a single `Get`.
- Order preservation across a mix of `latest` and pinned references.
- Fallback to name, including the ID rewrite.
- Paging through `nextPageToken` during the folder listing, and stopping early once every name is found.
- A single run mixing an ID-resolved and a name-resolved reference.
- One `List` call for a batch of fallbacks.
- Both "no current version" errors, and the combined message for several unresolvable references.
- The ID lookup failure surviving into the final message when the name lookup finds nothing.
- A denied folder listing naming `lockbox.viewer` as the fix.
- More references than the concurrency limit.

The mock gained `__setSecretList`, `__setGetSecretFail`, `__setUnknownSecretIds`, `__setListPageSize` and
`__setListFailure` to drive these paths. `__setUnknownSecretIds` makes `Get` fail for named ids only, which is what
exercises the mixed case.

## Consequences

### Positive

- Workflows can reference secrets by name, and survive a secret being recreated.
- No change for existing users: same input format, same IAM roles, same API calls.
- The folder listing is lazy, so the cost is paid only by workflows that use names.
- Grouping by reference means a secret read by several environment variables costs one `Get`, not one per key — fewer
  calls than before this change for a common input shape.

### Negative

- Name-based references require the broader `lockbox.viewer` role for the deploy credentials.
- Each distinct name costs one rejected `Get` before the listing.
- A typo in a secret ID now produces "failed to resolve" only after the folder listing, rather than immediately — and if
  the deploy credentials cannot list the folder, the reported error is about the listing rather than the typo.

### Neutral

- Only `latest` references can use a name. A reference pinned to an explicit version is not resolved by the action and
  must therefore still use an ID.
- A name is resolved only within `folder-id`. A secret in another folder is still reachable by ID.

## Related ADRs

- **ADR 002**: Lockbox Secrets — the `secrets` input and `latest` version resolution this builds on.
