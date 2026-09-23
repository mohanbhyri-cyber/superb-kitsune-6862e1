// smrt-notebook-predictor.js
// ============================================================
// Adapted from the uploaded "NIFTY50 STOCK PREDICTION.ipynb" methodology:
// - 30-day input series
// - 7-day prediction horizon
// - standard scaling
// - BUY=1 / SELL=0 framing
//
// The uploaded notebook does NOT include trained model weights.
// Therefore this module uses a transparent live proxy score rather
// than pretending to run the original 3x LSTM(256) network.
// ============================================================

const finite = value =>
  Number.isFinite(
    Number(value)
  );

function zscore(values) {
  const clean =
    values
      .map(Number)
      .filter(finite);

  if (!clean.length) {
    return [];
  }

  const mean =
    clean.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    clean.length;

  const variance =
    clean.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) /
    clean.length;

  const sd =
    Math.sqrt(
      variance
    ) || 1;

  return values.map(
    value =>
      finite(value)
        ? (
            Number(value) -
            mean
          ) / sd
        : 0
  );
}

export function analyseNotebookPredictor(
  candles
) {

  const SERIES_LENGTH = 30;
  const PREDICT_LENGTH = 7;

  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
      SERIES_LENGTH + 8
  ) {
    return {
      ready: false,
      mode:
        'ADAPTED_PROXY',
      signal:
        'WARMING UP',
      score:
        0,
      seriesLength:
        SERIES_LENGTH,
      horizonDays:
        PREDICT_LENGTH,
      reason:
        'Need at least 38 daily candles.'
    };
  }

  const rows =
    candles.slice(
      -SERIES_LENGTH
    );

  const closes =
    rows.map(
      row =>
        Number(
          row.close
        )
    );

  const volumes =
    rows.map(
      row =>
        Number(
          row.volume
        ) || 0
    );

  const scaledClose =
    zscore(
      closes
    );

  const scaledVolume =
    zscore(
      volumes
    );

  const latest =
    closes.at(-1);

  const close7 =
    closes.at(-8);

  const close14 =
    closes.at(-15);

  const ret7 =
    finite(latest) &&
    finite(close7) &&
    close7 !== 0
      ? (
          (
            latest -
            close7
          ) /
          close7
        ) * 100
      : 0;

  const ret14 =
    finite(latest) &&
    finite(close14) &&
    close14 !== 0
      ? (
          (
            latest -
            close14
          ) /
          close14
        ) * 100
      : 0;

  const recentScaled =
    scaledClose.slice(
      -7
    );

  const olderScaled =
    scaledClose.slice(
      -14,
      -7
    );

  const recentMean =
    recentScaled.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    recentScaled.length;

  const olderMean =
    olderScaled.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    olderScaled.length;

  const closeMomentum =
    recentMean -
    olderMean;

  const volumePulse =
    scaledVolume
      .slice(-5)
      .reduce(
        (sum, value) =>
          sum + value,
        0
      ) / 5;

  // Transparent proxy, not the notebook's trained LSTM.
  const raw =
    ret7 * 0.9 +
    ret14 * 0.35 +
    closeMomentum * 8 +
    volumePulse * 1.5;

  const probability =
    1 /
    (
      1 +
      Math.exp(
        -raw / 4
      )
    );

  let signal =
    'NO TRADE';

  if (
    probability >= 0.58
  ) {
    signal =
      'BUY';
  } else if (
    probability <= 0.42
  ) {
    signal =
      'SELL';
  }

  const score =
    Math.round(
      Math.abs(
        probability -
        0.5
      ) *
      200
    );

  return {
    ready: true,
    mode:
      'ADAPTED_PROXY',
    signal,
    score,
    buyProbability:
      probability,
    sellProbability:
      1 - probability,
    seriesLength:
      SERIES_LENGTH,
    horizonDays:
      PREDICT_LENGTH,
    ret7,
    ret14,
    closeMomentum,
    volumePulse,
    latestClose:
      latest,
    reason:
      signal === 'BUY'
        ? '30-day scaled trend proxy favors higher NIFTY over the next 7-day horizon.'
        : signal === 'SELL'
          ? '30-day scaled trend proxy favors lower NIFTY over the next 7-day horizon.'
          : 'The adapted 30-day / 7-day proxy is not directional enough.'
  };
}
