// smrt-global-watch.js
// ============================================================
// SMRT 24/7 GLOBAL WATCH
// Uses verified, timestamped external global-market cues only.
// It does NOT claim NIFTY is tradable outside NSE market hours.
// Missing, stale or untimestamped data is neutral and cannot vote.
// ============================================================

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));

const timestampMs = value => {
  if (value === null || value === undefined || value === '') return null;
  if (finite(value)) {
    const n = Number(value);
    // Accept epoch seconds or milliseconds.
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

export function analyseGlobalWatch(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const now = finite(payload?.now) ? Number(payload.now) : Date.now();
  const maxAgeMs = finite(payload?.maxAgeMs)
    ? Math.max(60000, Number(payload.maxAgeMs))
    : 20 * 60 * 1000;

  let score = 0;
  let maxScore = 0;
  const reasons = [];
  let freshCount = 0;

  const rows = items.map(item => {
    const itemTime = timestampMs(
      item?.timestamp ?? item?.time ?? item?.updated ?? item?.updatedAt
    );
    const ageMs = itemTime === null ? null : Math.max(0, now - itemTime);
    const fresh = itemTime !== null && ageMs <= maxAgeMs;

    const change = Number(item?.changePercent);
    const momentum = Number(item?.momentum);

    let side = 0;
    let weight = 0;

    // No timestamp = no vote. Stale source = no vote.
    if (fresh) {
      freshCount++;

      if (item.role === 'risk') {
        weight = String(item.key || '').includes('futures') ? 3 : 2;

        if (finite(change)) {
          if (change > 0.12) side = 1;
          else if (change < -0.12) side = -1;
        }

        if (side === 0 && finite(momentum)) {
          if (momentum > 0.08) side = 1;
          else if (momentum < -0.08) side = -1;
        }
      } else if (item.role === 'inverse') {
        weight = 2;
        if (finite(change)) {
          if (change > 1) side = -1;
          else if (change < -1) side = 1;
        }
      } else if (item.role === 'inverse_small') {
        weight = 1;
        if (finite(change)) {
          if (change > 0.18) side = -1;
          else if (change < -0.18) side = 1;
        }
      }
    }

    maxScore += weight;
    score += side * weight;

    if (side !== 0) {
      reasons.push(
        String(item?.name || item?.key || 'Global source') + ' ' +
        (side === 1 ? 'supports bullish bias' : 'supports bearish bias')
      );
    }

    return {
      ...item,
      side,
      weight,
      fresh,
      ageMs
    };
  });

  const confidence = maxScore > 0
    ? Math.round(Math.abs(score) / maxScore * 100)
    : 0;

  // Require at least two fresh sources before Global Watch may become
  // directional. One isolated external quote cannot create market bias.
  const fresh = freshCount >= 2;
  let bias = 'NEUTRAL';

  if (fresh && score >= 4) {
    bias = confidence >= 60 ? 'BULLISH' : 'LEAN BULLISH';
  } else if (fresh && score <= -4) {
    bias = confidence >= 60 ? 'BEARISH' : 'LEAN BEARISH';
  }

  return {
    bias,
    score: fresh ? score : 0,
    confidence: fresh ? confidence : 0,
    rows,
    reasons: fresh ? reasons.slice(0, 6) : [],
    sourceCount: rows.length,
    freshCount,
    fresh,
    maxAgeMs,
    updated: now
  };
}
