# Portal reliability improvements — 2026-09-12

Branch: `codex/portal-reliability-optimizations` · baseline: `2b2778c`.

This pass improves permissions and task completion in the portal and its shared
WhatsApp assistant. It makes no visual changes, adds no dependencies or database
migrations, and changes no membership in the existing permission whitelists.
Production was not modified or deployed during validation.

## Measured results

The same initial 35 regression scenarios were run before and after the fixes.
They exercise real Hono middleware/router/tool functions with mocked external
services. They deliberately target the defects from the review; their pass rate
is **not** an estimate of production success or the application's general quality.

| Regression group | Before: passed / total | After: passed / total |
| --- | ---: | ---: |
| Identity/impersonation and protected account administration | 7 / 15 | 15 / 15 |
| WhatsApp confirmation routing | 4 / 11 | 11 / 11 |
| Closure result reporting and error handling | 1 / 9 | 9 / 9 |
| Total | 12 / 35 | 35 / 35 |

Individual outcomes are retained in [portal-reliability-evidence.json](portal-reliability-evidence.json).

- Existing baseline suite: **767 tests in 80 files**, passing during the review.
- Final suite: **809 tests in 84 files**, all passing, including **42 new tests**.
- A routed closure confirmation calls `pendienteActivo` **once instead of twice**.
  This removes one redundant lookup. Checking the exact outbox receipt adds one
  status read for Monday closures: this is not a claim of fewer total closure
  queries or a measured reduction in end-user latency.
- Four additional tests execute the production SQL against in-memory SQLite:
  distinct receipts for two writes to one opportunity; only one successful claim
  for two simultaneous confirmations; expiry enforced at claim time; a prior NO
  prevents a later SÍ from claiming the same confirmation.
- Three additional behavior tests check simultaneous router calls, a NO that
  arrives after another request claimed the confirmation, and preservation of a
  closure reason while the requested change remains unconfirmed.

## Changes and user impact

### Permissions remain bounded during impersonation

`identityAccess.ts` checks the existing profit, executive-query and private-zone
whitelists before allowing impersonation. A non-whitelisted admin cannot acquire
those permissions by sending another person's email in `X-Impersonate-Email`.
Administrators with sufficient access retain permitted impersonation.

The same check protects account creation and editing. Otherwise, an admin could
change a protected account's WhatsApp phone and act through that account. These
checks use the authenticated actor's email. This intentionally returns 403 for
previously possible privilege-escalating requests; ordinary authorized account
management remains available.

### Confirmation replies reach the correct handler

The WhatsApp router consumes SÍ/OK/NO only when it owns a pending closure. Without
that pending action, the reply reaches the conversational agent, which may be
waiting for confirmation to create a contact, opportunity or inventory movement.
Preference menus retain priority over numbered opportunities.

The router reads pending state once. A conditional SQL update claims the closure
confirmation; only the request that changes the row may execute it. Expiration is
checked again in that update, so a confirmation that expires after being read
cannot authorize a write.

### Closure replies reflect the write's state

`submitWrite` returns its inserted outbox ID using D1's existing insert metadata,
without an additional query or a schema change. The optional `outboxId` response
field is additive; native D1 writes do not have an outbox receipt.

The shared closure function checks that exact receipt after the flush and both
chat channels use the same response renderer:

| Observed outcome | Reply |
| --- | --- |
| Confirmed Monday write | Confirms the closure in Monday |
| Native D1 write | Confirms the closure in the portal |
| Pending/sent/unavailable status | Says confirmation is pending; avoids asking for a duplicate submission |
| Conflict | Says Monday returned a different value and directs the user to review |
| Failed | Reports that the closure could not be confirmed |

An unconfirmed operation no longer produces a success note. If the user supplies
a reason, the existing best-effort update path records it as an unconfirmed
request, preserving the distinction between intent and completion.

Async tool handlers are awaited inside `runTool`'s existing try/catch. Permission
and other execution failures therefore reach the structured error response
instead of rejecting past the handler.

## Validation

```sh
npm test
npm run typecheck
npm run build
npm run lint
git diff --check
```

The tests make no real calls to Monday, Meta or a model. SQL tests require the
Node SQLite module available in the repository's Node 22 CI environment.
The repository-wide linter still reports existing warnings in unrelated files;
modified/new TypeScript files were also linted separately.

## Limits and next measurements

These are local regression and SQL results. They do not establish faster page
loads, lower model spend, improved Meta delivery rates or fewer real-world sync
conflicts. Deployment and an observation window are needed for those claims.

This branch does not introduce durable WhatsApp queue processing, serialize whole
conversations, replace all prompt-only action confirmations, or repair historical
production data inconsistencies. Claiming a confirmation once also does not solve
crash recovery after that claim; durable action processing remains separate work.

After deployment, use `wa_entrante`, `agente_evento`, `wa_mensaje` and `outbox` to
compare task completion, rejected actions, pending/conflicting writes, reply
latency and delivery outcomes over equivalent periods. Measure successful
business tasks and failure rates per attempt, rather than using test counts as a
proxy for employee productivity.
