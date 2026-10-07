// Shared by every caller in this runtime. Never serves expired or failed data.
export function retryAfterMs(response, body = {}, now = Date.now()) {
  const header = response.headers.get('retry-after');
  const delay = header == null ? 0 : Number.isFinite(Number(header))
    ? Number(header) * 1000 : Date.parse(header) - now;
  return Math.max(0, Number.isFinite(delay) ? delay : 0,
    Number(body.retryAfterMs ?? body.retry_after_ms) || 0,
    (Number(body.retryAfter ?? body.retry_after) || 0) * 1000);
}

export class RequestCoordinator {
  constructor({ fetcher = (...args) => fetch(...args), now = () => Date.now(), floor = 60000 } = {}) {
    this.fetcher = fetcher;
    this.now = now;
    this.floor = floor;
    this.cache = new Map();
    this.pending = new Map();
    this.limits = new Map();
  }
  remaining(scope = 'upstox') {
    return Math.max(0, (this.limits.get(scope)?.until || 0) - this.now());
  }
  limit(delay = 0, scope = 'upstox') {
    const previous = this.limits.get(scope);
    const streak = previous && this.now() - previous.at < 600000 ? previous.streak + 1 : 1;
    const wait = Math.max(Number(delay) || 0, Math.min(900000, this.floor * 2 ** Math.min(10, streak - 1)));
    this.limits.set(scope, { streak, at: this.now(), until: Math.max(previous?.until || 0, this.now() + wait) });
    return this.remaining(scope);
  }
  error(scope) {
    return Object.assign(new Error('Upstox rate limit reached. Waiting before retry.'),
      { status: 429, rateLimited: true, retryAfterMs: this.remaining(scope) });
  }
  async request(url, options = {}, { scope = 'upstox', ttl = 0, valid = () => true } = {}) {
    // Signals belong to individual consumers; they must not abort a shared request.
    const { signal, ...sharedOptions } = options;
    if (signal?.aborted) throw signal.reason || new Error('Request aborted');
    const normalized = new URL(url, 'https://local.invalid');
    normalized.searchParams.sort();
    if (normalized.pathname === '/api/upstox-mtf-history' && !normalized.searchParams.has('count')) {
      normalized.searchParams.set('count', '260');
      normalized.searchParams.sort();
    }
    const key = scope + '|' + (options.method || 'GET') + '|' + normalized.href;
    const cached = this.cache.get(key);
    if (cached && cached.until > this.now()) return cached.response.clone();
    this.cache.delete(key);
    if (this.remaining(scope)) throw this.error(scope);
    if (!this.pending.has(key)) {
      const task = (async () => {
        const response = await this.fetcher(url, { ...sharedOptions, signal: AbortSignal.timeout(20000) });
        if (response.status === 429) {
          const body = await response.clone().json().catch(() => ({}));
          this.limit(retryAfterMs(response, body, this.now()), scope);
          throw this.error(scope);
        }
        if (response.ok && ttl > 0 && await valid(response.clone())) {
          if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(key, { response: response.clone(), until: this.now() + ttl });
        }
        return response;
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, task);
    }
    const response = await this.pending.get(key);
    if (signal?.aborted) throw signal.reason || new Error('Request aborted');
    return response.clone();
  }
}

export function endpointTtl(url) {
  if (/previous-history/.test(url)) return 3600000;
  if (/mtf-history|daily-history/.test(url)) return 300000;
  if (/historical-candle/.test(url)) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    return /intraday/.test(url) || url.includes(today) ? 60000 : 3600000;
  }
  if (/upstox-history/.test(url)) return 60000;
  if (/option\/contract|instruments\/search/.test(url)) return 21600000;
  if (/assets.upstox.com/.test(url)) return 21600000;
  if (/option\/chain|nifty-options|nifty-breadth/.test(url)) return 60000;
  if (/futures-vwap/.test(url)) return 30000;
  if (/market-quote|live-quote|\/api\/health/.test(url)) return 15000;
  return 0;
}

const browserRequests = new RequestCoordinator();
export const browserCooldownRemaining = () => browserRequests.remaining();
export const browserNoteRateLimit = delay => browserRequests.limit(delay);
export function marketRequest(url, options = {}) {
  const upstox = !/\/api\/(global-watch|external-nifty)/.test(url);
  return browserRequests.request(url, options, {
    scope: upstox ? 'upstox' : new URL(url, 'https://local.invalid').pathname,
    ttl: endpointTtl(url),
    valid: async response => {
      const body = await response.json().catch(() => null);
      return body?.live === true || body?.available === true;
    }
  });
}

const serverRequests = new RequestCoordinator();
export function serverUpstoxRequest(url, options = {}) {
  const authorization = new Headers(options.headers).get('authorization') || 'public';
  return serverRequests.request(url, options, {
    scope: authorization, ttl: endpointTtl(url),
    valid: async response => {
      const body = await response.json().catch(() => null);
      return body?.status === 'success' || body?.data != null;
    }
  });
}
