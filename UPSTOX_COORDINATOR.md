# Opt-in shared Upstox request controller

Status: production activation approved by the user on the existing Cloudflare
Free plan after an isolated deployed preview check. The production configuration
uses `worker.coordinator.js`, a SQLite binding and a one-time migration pause.
Frontend polling, quote/candle freshness, session rules, trade confirmations and
risk thresholds are unchanged. No plan upgrade or automatic order execution.

Validation: 251 Node tests pass, including 26 controller tests, and Wrangler
compiles the opt-in entrypoint in dry-run mode. The local SQLite runtime check
now passes: 20 simultaneous Worker health requests share one simulated broker
request, and a 120-second provider cooldown survives a full local runtime
restart without another broker request. An independent SQLite counter also
retains its value after restart. No real broker or Cloudflare deployment was
used. These are local integration results, not live latency measurements or
validation of Cloudflare's deployed namespace, billing or migration lifecycle.
An approved deployed Cloudflare simulation also verifies Worker-to-object
request sharing and a stored provider deadline across a new Worker version.
Its provider is a test-only lexical stub in a separate artifact, not a real
Upstox credential or live chart. The production source contains no mock/stub.

## One-time cutover pause

Production sets `UPSTOX_COORDINATOR_STARTUP_PAUSE_MS` to `1800000` (30 minutes).
The first authenticated market-data request stores one `startup:v1` absolute
deadline before any provider dispatch. This conservatively drains the old
regional feed's rolling 30-minute allowance instead of treating a new namespace
as fresh broker capacity. During this app-owned pause, the existing feed UI can
show its explicit migration reason and remaining wait; it is not a new trade
signal or a claim that Upstox issued this pause.

Reads, browser refreshes, credential rotation, configuration changes and new
Worker deployments do not renew or remove an existing stored deadline. A failed
startup write or invalid startup state/configuration fails closed with no broker
call. After the deadline expires, normal broker limits and genuine provider
Retry-After rules still apply. No public reset endpoint is provided.

The initial emulator failure was narrowed to long Windows database paths:
using short local fixture/Worker names lets SQLite objects start and persist.
Do not change Windows security settings or the production object identity to
work around a local test path. Once that fixture issue was removed, the runtime
also exposed an actual compatibility bug: workerd rejects `redirect: 'error'`.
The controller now uses `redirect: 'manual'` and explicitly rejects all 3xx
responses as 502 without following or caching them. Node regressions cover
301/302/303/307/308, and the clean compiled entrypoint passes the runtime check.

## What changes when enabled

All Upstox market-data routes, including health checks and fallback requests,
use the same named Durable Object (`smrt-upstox-data-v1`) within one namespace.
Different Worker instances/regions cannot independently restart this object's
budget or provider cooldown. Identical concurrent requests share one flight.
Different requests for the same API are serialized; quotes are not queued
behind the separate historical-candle API.

Before every actual broker request the object durably reserves one request.
Conservative rolling budgets are 40 requests/second, 400/minute and 1600/30
minutes per existing API scope. They are below the currently documented
Upstox Standard API ceilings (50/500/2000), not an increase in broker limits.
Cache hits do not consume a new reservation. Failed attempts do count.

Provider Retry-After (seconds or HTTP-date) is stored as an absolute deadline.
Reads never restart it; short valid waits are not extended to a fallback minute.
A missing/invalid provider deadline uses the existing conservative 60-second
fallback. A failed/timed-out network attempt also starts a conservative pause.

The existing Worker's cache-policy functions are injected into the controller.
Quotes retain the 15-second upstream TTL; genuine intraday candles retain 30
seconds or the candle boundary, whichever is sooner. Minute/hour warm-up ranges
retain five-minute reuse. Cache hits do not renew expiry. A client after candle
close cannot join a pre-close flight. Existing outer edge-response TTLs remain
unchanged. This is request coordination, not a WebSocket feed or a promise of
lower tick latency.

## Safety and privacy

- Only a strict allowlist of the existing Upstox market-data endpoints is
  accepted, always as upstream GET requests. Orders, funds, authentication,
  other hosts, URL credentials, unknown query keys and redirects are blocked.
- The namespace is an internal binding, not a new public app route. A fixed
  object name is shared by this single-user app, not a browser-supplied ID.
- The object reads the same server-side secret selection as the Worker.
  Internal requests contain a SHA-256 credential digest for configuration
  consistency, never the raw token. Raw tokens are not stored, logged or
  returned. Storage holds only API-scoped attempt times and retry state.
- Successful market payloads are memory-cached, not persisted. The cache has
  an 8 MiB/64-entry limit and a 512 KiB individual-entry limit. Empty/invalid
  candles, invalid quotes, provider error bodies and HTTP failures are not
  reusable successes. No bars, prices, timestamps or volume are fabricated.
- Upstream fetch/body reading has a 20-second abort signal; internal callers
  have a 30-second signal. The queue is bounded and old queued work is rejected.
- If an enabled binding or storage is unavailable, there is no direct broker
  retry around the controller. Existing public handlers can report unavailable
  data or attempt other allowed APIs, but every such call still uses the same
  controller. A health cooldown/outage is not mislabeled as an invalid token.
- All public market-data routes retain the central 429 status and remaining
  wait. Unavailable options/breadth results from the controller are not stored
  for an extra minute, which would otherwise restart or hide the real wait.

## Failure recovery must preserve unknown broker outcomes

A durable `inProgress` marker is written before dispatch and cleared only after
the result or retry deadline is saved. If completion cannot be saved, a restart
cannot safely know whether Upstox accepted the request or issued a long wait.
That API fails closed with unavailable data until operator investigation.

Do not delete state, rename the object, rotate credentials, switch namespaces
or disable the controller to get around a cooldown or uncertain outcome.
Recovery requires confirming the broker outcome/wait and obtaining operator
approval before any state repair. No automatic reset or public reset endpoint
is included. Drain in-flight requests before rollout/rollback where possible.

## Fixed failure categories

Unavailable responses now include a fixed diagnostic category for missing or
broken bindings, unreadable binding responses, storage read/write failures,
invalid startup/budget state, clock rollback, and an unknown prior broker
outcome. Categories come from an allowlist, never raw exception messages,
tokens, endpoint URLs, stored budget contents or provider response bodies.
No persistent logging setting or new public inspection/reset route is added.

`COORDINATOR_PRIOR_OUTCOME_UNKNOWN` is a stop condition requiring operator
investigation, not a new timeout that may be expired or cleared automatically.
Its stored marker and request reservations remain unchanged through reads,
restarts and elapsed time. Diagnostic deployment is not permission to reset
that marker or bypass a possible provider Retry-After.

## Review and isolated preview

Production uses `worker.coordinator.js` with the new binding and flag; existing
runtime variables are preserved via `keep_vars: true`. Tokens stay server-side.
The separate `wrangler.coordinator.jsonc` targets
`smrt-upstox-coordinator-preview`, uses `worker.coordinator.js`, enables the
flag, and declares a SQLite-backed Durable Object via a tagged migration.
The separate simulated deployment is not the normal Git-connected preview and
does not share a namespace or real token with production. A successful ordinary
build alone is not evidence of storage or live-feed correctness.

Run local tests with `node --test`. A local compile-only check is:

```powershell
npx.cmd wrangler@4.135.0 deploy --dry-run --config wrangler.coordinator.jsonc
```

The dry-run does not provision/deploy a namespace. Live preview deployment,
server-side secret configuration, billing changes and production activation
each require separate approval. Do not put keys in source, logs or this chat.
Verify the current Cloudflare configuration/plan and preserve existing access
controls before any live preview is deployed. New migrations/lifecycle changes
have rollout and rollback constraints; review them before provisioning.

After approved activation, verify real session candle timestamps, chart/AI
alignment, provider Retry-After and cross-instance request reuse. Node fixtures
and a Wrangler dry-run are not live latency or Cloudflare storage integration
measurements. Do not force a BUY/SELL signal to test the controller.

## Boundaries, cost and production rollout

Coordination covers only callers using this same namespace and fixed object ID.
An isolated preview has its own namespace; it does NOT share a request budget
with production. Other apps/services/Worker deployments using the same broker
account can still cause rate limits. Avoid concurrent real-broker preview and
production load without a deliberate shared-namespace plan. Token rotation
does not reset the controller's API budgets; cache data is credential-isolated.

Cloudflare Durable Objects have compute/storage usage and plan limits. A cache
miss normally performs a storage read plus reservation/completion writes;
cache hits reuse memory while the object is alive. Review expected traffic and
the account's plan before activation. No paid plan change was made or assumed.

The approved production configuration provisions the SQLite class with the
`upstox-coordinator-v1` migration and preserves existing variables. The account
was verified as Cloudflare Free; no subscription change is authorized. Free
request, duration and SQLite row/storage quotas remain hard constraints shared
with other account resources. Do not automatically upgrade the plan if a quota
is reached.

Keep the Durable Object class, binding, identity and stored deadlines intact
during rollback. Restoring an old version that omits the class/migration is not
a safe automatic rollback plan. Disabling coordination restores the old
regional path and loses the shared wait; never use it to bypass an active or
uncertain cooldown. Prefer a fail-closed outage to duplicate broker retries.

## Primary references

- [Upstox limits](https://upstox.com/developer/api-documentation/rate-limiting/)
- [Durable Object namespaces](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [Consistent storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Class lifecycle/migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Pricing and plan limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
