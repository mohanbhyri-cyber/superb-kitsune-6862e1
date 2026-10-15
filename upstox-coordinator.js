import { upstoxCredentialDigest } from './upstox-coordinator-client.js';

// Conservative app-owned budgets, below the documented Standard API ceilings
// of 50/s, 500/min and 2000/30min. Other apps using the same account are NOT
// covered by this object and can still consume Upstox's remaining allowance.
export const UPSTOX_APP_BUDGETS = Object.freeze([
  { window: 1000, limit: 40 },
  { window: 60000, limit: 400 },
  { window: 1800000, limit: 1600 }
]);
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;
const MAX_CACHE_ENTRIES = 64;

function response(result) {
  return new Response(JSON.stringify(result), { status: result.status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
const failure = (status, reason, retryAfterMs = 0) => ({ ok: false, status, reason, retryAfterMs });

export function allowedUpstoxEndpoint(endpoint) {
  try {
    if (typeof endpoint !== 'string' || endpoint.length > 8192) return null;
    const url = new URL(endpoint);
    if (url.origin !== 'https://api.upstox.com' || url.username || url.password || url.hash ||
        /%2f|%5c/i.test(url.pathname)) return null;
    let keys;
    if (url.pathname === '/v3/market-quote/quotes') keys = ['instrument_key'];
    else if (url.pathname === '/v2/option/chain') keys = ['instrument_key', 'expiry_date'];
    else if (url.pathname === '/v2/option/contract') keys = ['instrument_key'];
    else if (url.pathname === '/v2/instruments/search') keys = [
      'query', 'exchanges', 'segments', 'instrument_types', 'expiry', 'page_number', 'records'];
    else if (/^\/v3\/historical-candle\/intraday\/[^/]+\/(?:minutes|hours)\/\d+$/.test(url.pathname) ||
      /^\/v3\/historical-candle\/[^/]+\/(?:minutes|hours|days)\/\d+\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(url.pathname)) keys = [];
    else return null;
    if ([...url.searchParams.keys()].some(key => !keys.includes(key))) return null;
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

function validBudgetState(value) {
  if (value === undefined) return { times: [], retryAt: 0, inProgress: false };
  if (!value || !Array.isArray(value.times) || value.times.length > 1600 ||
      !Number.isFinite(value.retryAt) || value.retryAt < 0 ||
      typeof value.inProgress !== 'boolean' ||
      value.times.some((time, i) => !Number.isFinite(time) || time < 0 || (i > 0 && time < value.times[i - 1]))) {
    throw new Error('Invalid coordinator state');
  }
  return value;
}

// Pure controller; worker.coordinator.js provides the Cloudflare DO base class.
// Policies are the original Worker's functions, not a second set of TTL rules.
export class UpstoxCoordinator {
  constructor(ctx, env, policies) {
    this.storage = ctx.storage;
    this.env = env;
    this.policies = policies;
    this.cache = new Map();
    this.cacheBytes = 0;
    this.pending = new Map();
    this.tails = new Map();
  }

  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/fetch') {
      return response(failure(405, 'Internal market-data POST required.'));
    }
    try {
      const text = await request.text();
      if (text.length > 10000) return response(failure(400, 'Invalid market-data request.'));
      let input;
      try { input = JSON.parse(text); }
      catch { return response(failure(400, 'Invalid market-data request.')); }
      const endpoint = allowedUpstoxEndpoint(input?.endpoint);
      if (!endpoint) return response(failure(400, 'Unsupported market-data endpoint.'));
      const token = this.env.UPSTOX_EXTENDED_TOKEN || this.env.UPSTOX_ANALYTICS_TOKEN ||
        this.env.UPSTOX_ACCESS_TOKEN || this.env.UPSTOX_TOKEN;
      if (!token || input.credential !== await upstoxCredentialDigest(token)) {
        return response(failure(503, 'Coordinator credential configuration mismatch.'));
      }
      return response(await this.dispatch(endpoint, token, input.credential));
    } catch {
      // No raw provider body, URL, credentials or storage details in failures.
      return response(failure(503, 'Upstox coordinator unavailable. No direct retry was made.'));
    }
  }

  cached(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.cache.delete(key); this.cacheBytes -= item.bytes;
      return null;
    }
    this.cache.delete(key); this.cache.set(key, item);
    return { ok: true, body: JSON.parse(item.text) };
  }

  remember(key, endpoint, body, expiresAt) {
    const usable = endpoint.includes('/historical-candle/')
      ? this.policies.candles(body)
      : (body?.status === undefined || body.status === 'success') && body?.data &&
        (endpoint.includes('/market-quote/quotes')
          ? Object.values(body.data).some(q =>
              (typeof q?.last_price === 'number' || (typeof q?.last_price === 'string' && q.last_price.trim() !== '')) &&
              Number.isFinite(Number(q?.last_price)) && Number(q.last_price) > 0)
          : Array.isArray(body.data) ? body.data.length > 0 : typeof body.data === 'object');
    if (!usable || expiresAt <= Date.now()) return;
    const text = JSON.stringify(body), bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_ENTRY_BYTES) return;
    const prior = this.cache.get(key);
    if (prior) { this.cache.delete(key); this.cacheBytes -= prior.bytes; }
    while (this.cache.size && (this.cache.size >= MAX_CACHE_ENTRIES || this.cacheBytes + bytes > MAX_CACHE_BYTES)) {
      const oldest = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(oldest).bytes; this.cache.delete(oldest);
    }
    this.cache.set(key, { text, bytes, expiresAt }); this.cacheBytes += bytes;
  }

  async dispatch(endpoint, token, credential) {
    const key = credential + '|' + endpoint;
    const startedAt = Date.now();
    const cached = this.cached(key);
    if (cached) return cached;
    const pending = this.pending.get(key);
    if (pending) {
      const result = await pending.promise;
      if (pending.deadline > startedAt || !result.ok) return result;
      // A request after candle close must not join a pre-close snapshot.
      return this.dispatch(endpoint, token, credential);
    }
    if (this.pending.size >= 64) return failure(429, 'App market-data queue is busy.', 1000);
    const scope = this.policies.scope(endpoint);
    const deadline = this.policies.deadline(endpoint, startedAt);
    const previous = this.tails.get(scope) || Promise.resolve();
    const promise = previous.catch(() => {}).then(() => Date.now() - startedAt > 20000
      ? failure(429, 'App market-data queue wait exceeded.', 1000)
      : this.load(endpoint, token, key, scope, deadline));
    const flight = { promise, deadline };
    this.pending.set(key, flight); this.tails.set(scope, promise);
    try { return await promise; }
    finally {
      if (this.pending.get(key) === flight) this.pending.delete(key);
      if (this.tails.get(scope) === promise) this.tails.delete(scope);
    }
  }

  async load(endpoint, token, key, scope, deadline) {
    const cached = this.cached(key);
    if (cached) return cached;
    const stateKey = 'budget:v1:' + scope;
    const state = validBudgetState(await this.storage.get(stateKey));
    const now = Date.now();
    // If the object stopped after dispatch but before its result was saved,
    // the broker's actual outcome/deadline is unknown. Fail closed for operator
    // investigation instead of treating a restart as permission to retry.
    if (state.inProgress) throw new Error('Uncertain prior provider attempt');
    // A server-clock rollback must not erase an already reserved request.
    if (state.times.some(time => time > now)) throw new Error('Clock moved backwards');
    const times = state.times.filter(time => time > now - 1800000);
    let retryAt = state.retryAt;
    for (const budget of UPSTOX_APP_BUDGETS) {
      const recent = times.filter(time => time > now - budget.window);
      if (recent.length >= budget.limit) {
        retryAt = Math.max(retryAt, recent[recent.length - budget.limit] + budget.window);
      }
    }
    if (retryAt > now) return failure(429, 'Upstox request budget/cooldown active.', Math.max(1000, retryAt - now));
    // Persist the reservation BEFORE dispatch, including failed/timed-out
    // attempts. A restart cannot reset the rolling budget or Retry-After.
    times.push(now);
    await this.storage.put(stateKey, { times, retryAt: 0, inProgress: true });
    let provider, body;
    try {
      // workerd supports manual/follow, not the browser/Node redirect:error.
      // Never follow a redirect with broker credentials attached.
      provider = await fetch(endpoint, { method: 'GET', redirect: 'manual',
        signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
      if (provider.ok) body = await provider.json();
      else await provider.body?.cancel();
    } catch {
      await this.storage.put(stateKey, { times, retryAt: Date.now() + 60000, inProgress: false });
      return failure(503, 'Upstox request failed or timed out. Retry paused.');
    }
    if (provider.status === 429) {
      const header = provider.headers.get('retry-after');
      const delay = header && Number.isFinite(Number(header)) ? Number(header) * 1000
        : header ? Date.parse(header) - Date.now() : 0;
      const until = Date.now() + (Number.isFinite(delay) && delay > 0 ? Math.max(1000, delay) : 60000);
      await this.storage.put(stateKey, { times, retryAt: Math.max(state.retryAt, until), inProgress: false });
      return failure(429, 'Upstox rate limit reached. Waiting before retry.', Math.max(1000, until - Date.now()));
    }
    await this.storage.put(stateKey, { times, retryAt: 0, inProgress: false });
    if (provider.status >= 300 && provider.status < 400) return failure(502, 'Upstox returned an unexpected redirect.');
    if (!provider.ok) return failure(provider.status, 'Upstox returned HTTP ' + provider.status + '.');
    if (body?.status !== undefined && body.status !== 'success') return failure(502, 'Upstox returned an unsuccessful data response.');
    this.remember(key, endpoint, body, Math.min(Date.now() + this.policies.ttl(endpoint), deadline));
    return { ok: true, body };
  }
}
