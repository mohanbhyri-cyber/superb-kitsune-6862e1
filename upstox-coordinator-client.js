// Internal binding only. Never send broker credentials to a browser or URL.
export async function upstoxCredentialDigest(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}

export async function coordinatedUpstoxRequest(endpoint, token, namespace) {
  try {
    if (!namespace) throw new Error('Missing coordinator binding');
    const credential = await upstoxCredentialDigest(token);
    const stub = namespace.get(namespace.idFromName('smrt-upstox-data-v1'));
    const response = await stub.fetch(new Request('https://upstox-coordinator.internal/fetch', {
      method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, credential })
    }));
    const result = await response.json();
    if (response.ok && result?.ok === true && result.body !== undefined) return result.body;
    const error = new Error(result?.reason || 'Upstox coordinator unavailable.');
    error.status = response.ok ? 503 : response.status;
    error.rateLimited = error.status === 429;
    error.retryAfterMs = error.rateLimited && Number.isFinite(result?.retryAfterMs) && result.retryAfterMs > 0
      ? Math.max(1000, result.retryAfterMs) : 0;
    error.coordinator = true;
    throw error;
  } catch (error) {
    if (error?.coordinator) throw error;
    // An enabled but unavailable coordinator must NEVER fall back to direct
    // broker requests: that would bypass its account-wide budget/cooldown.
    const unavailable = new Error('Upstox coordinator unavailable. No direct retry was made.');
    unavailable.status = 503;
    unavailable.coordinator = true;
    throw unavailable;
  }
}
