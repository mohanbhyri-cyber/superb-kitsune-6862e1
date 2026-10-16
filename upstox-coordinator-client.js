// Internal binding only. Never send broker credentials to a browser or URL.
const DIAGNOSTIC_REASONS = Object.freeze({
  COORDINATOR_UNAVAILABLE: 'Upstox coordinator unavailable. No direct retry was made.',
  COORDINATOR_BINDING_MISSING: 'Feed controller binding is unavailable.',
  COORDINATOR_CLIENT_DIGEST_FAILED: 'Feed controller credential check could not start.',
  COORDINATOR_LOOKUP_FAILED: 'Feed controller instance lookup failed.',
  COORDINATOR_REQUEST_FAILED: 'Feed controller request failed or timed out.',
  COORDINATOR_RESPONSE_INVALID: 'Feed controller returned an unreadable response.',
  COORDINATOR_STATE_INVALID: 'Feed controller stored budget state is invalid. Operator review required.',
  COORDINATOR_STARTUP_CONFIG_INVALID: 'Feed controller safety-pause configuration is invalid.',
  COORDINATOR_STARTUP_STATE_INVALID: 'Feed controller stored safety-pause state is invalid.',
  COORDINATOR_PRIOR_OUTCOME_UNKNOWN: 'A previous broker request has an unknown outcome. Operator review required; no direct retry was made.',
  COORDINATOR_CLOCK_ROLLBACK: 'Feed controller clock is behind a stored request timestamp. No direct retry was made.',
  COORDINATOR_STORAGE_READ_FAILED: 'Feed controller could not read its stored safety state.',
  COORDINATOR_STORAGE_WRITE_FAILED: 'Feed controller could not save its safety state. Operator review required.'
});

export class UpstoxCoordinatorError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(DIAGNOSTIC_REASONS, code) ? code : 'COORDINATOR_UNAVAILABLE';
    super(DIAGNOSTIC_REASONS[safeCode] + ' [' + safeCode + ']');
    this.code = safeCode;
  }
}

export function coordinatorDiagnosticReason(error) {
  // Never interpolate a raw provider/platform error, URL, credential or state.
  return error instanceof UpstoxCoordinatorError
    ? new UpstoxCoordinatorError(error.code).message
    : new UpstoxCoordinatorError('COORDINATOR_UNAVAILABLE').message;
}

export async function upstoxCredentialDigest(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}

export async function coordinatedUpstoxRequest(endpoint, token, namespace) {
  let stage = 'COORDINATOR_BINDING_MISSING';
  try {
    if (!namespace) throw new Error('Missing coordinator binding');
    stage = 'COORDINATOR_CLIENT_DIGEST_FAILED';
    const credential = await upstoxCredentialDigest(token);
    stage = 'COORDINATOR_LOOKUP_FAILED';
    const stub = namespace.get(namespace.idFromName('smrt-upstox-data-v1'));
    stage = 'COORDINATOR_REQUEST_FAILED';
    const response = await stub.fetch(new Request('https://upstox-coordinator.internal/fetch', {
      method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, credential })
    }));
    stage = 'COORDINATOR_RESPONSE_INVALID';
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
    const unavailable = new UpstoxCoordinatorError(stage);
    unavailable.status = 503;
    unavailable.coordinator = true;
    throw unavailable;
  }
}
