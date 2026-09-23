// smrt-ai-nifty.js
// ============================================================
// SMRT AI NIFTY 50
// Multi-source deterministic decision-support engine.
// Combines Upstox app state with independent external sources.
// No automatic order placement and no guaranteed accuracy.
// ============================================================

const finite = value =>
  Number.isFinite(
    Number(value)
  );

const sourceSide = source => {
  if (!source) return 0;

  if (
    source.name ===
    'TradingView'
  ) {
    const rec =
      Number(
        source.recommendAll
      );

    if (finite(rec)) {
      if (rec >= 0.2) {
        return 1;
      }

      if (rec <= -0.2) {
        return -1;
      }
    }

    const ema20 =
      Number(
        source.ema20
      );

    const ema50 =
      Number(
        source.ema50
      );

    if (
      finite(ema20) &&
      finite(ema50)
    ) {
      if (ema20 > ema50) {
        return 1;
      }

      if (ema20 < ema50) {
        return -1;
      }
    }

    return 0;
  }

  const change =
    Number(
      source.changePercent
    );

  const momentum =
    Number(
      source.momentum
    );

  const combined =
    (
      finite(change)
        ? change
        : 0
    ) +
    (
      finite(momentum)
        ? momentum
        : 0
    );

  if (combined > 0.08) {
    return 1;
  }

  if (combined < -0.08) {
    return -1;
  }

  return 0;
};

export function analyseSmrtAiNifty({
  upstoxPrice,
  finalizer,
  mtf,
  external
} = {}) {

  const reasons = [];

  let score = 0;

  const finalizerState =
    finalizer?.state ||
    'NO TRADE';

  if (
    finalizerState.includes(
      'BUY'
    )
  ) {
    score +=
      finalizerState.includes(
        'STRONG'
      )
        ? 35
        : 28;

    reasons.push(
      'SMRT Finalizer bullish'
    );
  } else if (
    finalizerState.includes(
      'SELL'
    )
  ) {
    score -=
      finalizerState.includes(
        'STRONG'
      )
        ? 35
        : 28;

    reasons.push(
      'SMRT Finalizer bearish'
    );
  }

  const mtfRows = [
    mtf?.['5m'],
    mtf?.['15m'],
    mtf?.['1h']
  ];

  let mtfBull = 0;
  let mtfBear = 0;

  for (
    const row of mtfRows
  ) {
    if (row?.side === 1) {
      mtfBull += 1;
      score += 10;
    }

    if (row?.side === -1) {
      mtfBear += 1;
      score -= 10;
    }
  }

  if (mtfBull === 3) {
    reasons.push(
      '5m / 15m / 1h bullish'
    );
  } else if (mtfBear === 3) {
    reasons.push(
      '5m / 15m / 1h bearish'
    );
  } else if (
    mtfBull ||
    mtfBear
  ) {
    reasons.push(
      'MTF mixed ' +
      mtfBull +
      ' bull / ' +
      mtfBear +
      ' bear'
    );
  }

  const sources =
    Array.isArray(
      external?.sources
    )
      ? external.sources
      : [];

  let externalBull = 0;
  let externalBear = 0;
  let externalNeutral = 0;

  for (
    const source of sources
  ) {
    const side =
      sourceSide(
        source
      );

    if (side === 1) {
      externalBull += 1;

      score +=
        source.name ===
        'TradingView'
          ? 15
          : 12;

      reasons.push(
        source.name +
        ' bullish'
      );
    } else if (
      side === -1
    ) {
      externalBear += 1;

      score -=
        source.name ===
        'TradingView'
          ? 15
          : 12;

      reasons.push(
        source.name +
        ' bearish'
      );
    } else {
      externalNeutral += 1;
    }
  }

  const upstox =
    Number(
      upstoxPrice
    );

  const externalPrices =
    sources
      .map(
        source =>
          Number(
            source.price
          )
      )
      .filter(
        finite
      );

  let priceAgreement =
    null;

  if (
    finite(upstox) &&
    externalPrices.length
  ) {
    const average =
      externalPrices
        .reduce(
          (
            total,
            value
          ) =>
            total + value,
          0
        ) /
      externalPrices.length;

    priceAgreement =
      Math.abs(
        average -
        upstox
      ) /
      upstox *
      100;

    if (
      priceAgreement <= 0.15
    ) {
      reasons.push(
        'External prices agree with Upstox'
      );
    }
  }

  const absScore =
    Math.min(
      100,
      Math.round(
        Math.abs(
          score
        )
      )
    );

  const directionalSources =
    externalBull +
    externalBear;

  let signal =
    'NO TRADE';

  if (
    score >= 45 &&
    (
      externalBull >= 1 ||
      mtfBull >= 2
    )
  ) {
    signal =
      'BUY';
  } else if (
    score <= -45 &&
    (
      externalBear >= 1 ||
      mtfBear >= 2
    )
  ) {
    signal =
      'SELL';
  }

  if (
    externalBull > 0 &&
    externalBear > 0
  ) {
    signal =
      'NO TRADE';

    reasons.push(
      'External sources disagree'
    );
  }

  const plan =
    signal !==
      'NO TRADE' &&
    finalizer?.plan
      ? finalizer.plan
      : null;

  return {
    signal,
    confidence:
      absScore,
    rawScore:
      score,
    externalBull,
    externalBear,
    externalNeutral,
    directionalSources,
    sourceCount:
      sources.length,
    priceAgreement,
    reasons:
      reasons.slice(
        0,
        8
      ),
    plan,
    updated:
      Date.now()
  };
}
