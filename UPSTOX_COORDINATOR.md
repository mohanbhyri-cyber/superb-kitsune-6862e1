# Opt-in shared Upstox request controller

Status: review/isolated-preview preparation only. Not activated in production.
The existing `wrangler.jsonc`, frontend, polling cadence, quote/candle freshness,
session rules, trade confirmations and risk thresholds are unchanged.

Validation: 248 Node tests pass, including 23 controller tests, and Wrangler
compiles the opt-in entrypoint in dry-run mode. The local SQLite runtime smoke
check could not complete: a minimal independent SQLite-backed control object
also failed with an internal emulator error before any simulated broker call.
This is NOT a passing Durable Object runtime/storage integration test. Keep the
upgrade inactive until an approved isolated runtime/preview check succeeds.

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

## Review and isolated preview

Production continues to use `worker.js` without the new binding or flag.
The separate `wrangler.coordinator.jsonc` targets
`smrt-upstox-coordinator-preview`, uses `worker.coordinator.js`, enables the
flag, and declares a SQLite-backed Durable Object via a tagged migration.
The default Git-connected preview build still uses the unchanged production
configuration: its success does NOT exercise the enabled controller.

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

Production activation needs an explicit entrypoint/binding/migration plan,
capacity review, provider cooldown-aware cutover, monitoring and a rollback
decision. Merely merging this PR does not enable the controller. Disabling it
restores the old regional path and loses central coordination; that is not a
safe cooldown bypass and must not happen while an active/unknown wait remains.

## Primary references

- [Upstox limits](https://upstox.com/developer/api-documentation/rate-limiting/)
- [Durable Object namespaces](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [Consistent storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Class lifecycle/migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Pricing and plan limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
