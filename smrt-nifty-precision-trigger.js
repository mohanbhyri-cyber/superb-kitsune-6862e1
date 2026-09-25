// smrt-nifty-precision-trigger.js
// NIFTY 50 closed-candle BUY/SELL trigger.
// Decision-support only. Finalizer remains final authority.

const finite = v =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  Number.isFinite(Number(v));

const upper = v =>
  String(v || "").trim().toUpperCase();

export function niftyPrecisionTrigger({
  candles,
  ema9,
  ema21,
  ema50,
  rsi,
  macdHistogram,
  trend,
  priceAction,
  sslQqe,
  mtf,
  marketRegime = null
} = {}) {

  const n = Array.isArray(candles)
    ? candles.length
    : 0;

  // IMPORTANT:
  // candles[n - 1] may still be forming.
  const i = n - 2;

  const noTrade = reason => ({
    ready: false,
    signal: "NO TRADE",
    direction: 0,
    score: 0,
    confidence: 0,
    candleIndex: i,
    reason
  });

  if (i < 1) {
    return noTrade("Not enough closed candles");
  }

  const e9 = Number(ema9?.[i]);
  const e21 = Number(ema21?.[i]);
  const e50 = Number(ema50?.[i]);

  const r = Number(rsi?.[i]);
  const macd = Number(macdHistogram?.[i]);

  const adx = Number(trend?.adx?.[i]);
  const plusDI = Number(trend?.plusDI?.[i]);
  const minusDI = Number(trend?.minusDI?.[i]);

  const stDirection =
    Number(trend?.direction?.[i]);

  if (![
    e9,
    e21,
    e50,
    r,
    macd,
    adx,
    plusDI,
    minusDI
  ].every(finite)) {
    return noTrade(
      "Mandatory indicator data not ready"
    );
  }

  // -----------------------------------------
  // MARKET REGIME GATE
  // -----------------------------------------

  const regime =
    upper(
      marketRegime?.regime ||
      marketRegime?.state
    );

  if (
    regime === "EXTREME CHOP" ||
    regime === "RANGE"
  ) {
    return noTrade(
      `Market regime blocked: ${regime}`
    );
  }

  // -----------------------------------------
  // TREND
  // -----------------------------------------

  const emaBull =
    e9 > e21 &&
    e21 > e50;

  const emaBear =
    e9 < e21 &&
    e21 < e50;

  const dmiBull =
    adx >= 20 &&
    plusDI > minusDI;

  const dmiBear =
    adx >= 20 &&
    minusDI > plusDI;

  const superBull =
    stDirection === 1;

  const superBear =
    stDirection === -1;

  // -----------------------------------------
  // MOMENTUM
  // -----------------------------------------

  const rsiBull =
    r >= 52 &&
    r <= 70;

  const rsiBear =
    r <= 48 &&
    r >= 30;

  const macdBull =
    macd > 0;

  const macdBear =
    macd < 0;

  // -----------------------------------------
  // STRUCTURE
  // Adjust these names if your PA output
  // uses a different property.
  // -----------------------------------------

  const structure =
    upper(
      priceAction?.structure ||
      priceAction?.signal ||
      priceAction?.bos
    );

  const structureBull =
    structure.includes("BULL") ||
    structure.includes("BOS UP") ||
    structure.includes("HH") ||
    structure.includes("HL");

  const structureBear =
    structure.includes("BEAR") ||
    structure.includes("BOS DOWN") ||
    structure.includes("LH") ||
    structure.includes("LL");

  // -----------------------------------------
  // SSL + QQE
  // -----------------------------------------

  const sslSignal =
    upper(
      sslQqe?.signal ||
      sslQqe?.direction
    );

  const sslBull =
    sslSignal.includes("BUY") ||
    sslSignal.includes("BULL");

  const sslBear =
    sslSignal.includes("SELL") ||
    sslSignal.includes("BEAR");

  // -----------------------------------------
  // MULTI-TIMEFRAME
  // -----------------------------------------

  const mtfSignal =
    upper(
      mtf?.signal ||
      mtf?.direction ||
      mtf?.bias
    );

  const mtfBull =
    mtfSignal.includes("BUY") ||
    mtfSignal.includes("BULL");

  const mtfBear =
    mtfSignal.includes("SELL") ||
    mtfSignal.includes("BEAR");

  // -----------------------------------------
  // SCORE
  // -----------------------------------------

  let bull = 0;
  let bear = 0;

  if (emaBull) bull += 2;
  if (emaBear) bear += 2;

  if (superBull) bull += 2;
  if (superBear) bear += 2;

  if (dmiBull) bull += 2;
  if (dmiBear) bear += 2;

  if (rsiBull) bull += 1;
  if (rsiBear) bear += 1;

  if (macdBull) bull += 1;
  if (macdBear) bear += 1;

  if (structureBull) bull += 2;
  if (structureBear) bear += 2;

  if (sslBull) bull += 1;
  if (sslBear) bear += 1;

  if (mtfBull) bull += 2;
  if (mtfBear) bear += 2;

  const maximum = 13;

  // Mandatory directional alignment.
  const mandatoryBull =
    emaBull &&
    superBull &&
    dmiBull &&
    mtfBull;

  const mandatoryBear =
    emaBear &&
    superBear &&
    dmiBear &&
    mtfBear;

  let signal = "NO TRADE";
  let direction = 0;
  let score = Math.max(bull, bear);

  if (
    mandatoryBull &&
    bull >= 10 &&
    bear <= 2
  ) {
    signal =
      bull >= 12
        ? "STRONG BUY"
        : "BUY";

    direction = 1;

  } else if (
    mandatoryBear &&
    bear >= 10 &&
    bull <= 2
  ) {
    signal =
      bear >= 12
        ? "STRONG SELL"
        : "SELL";

    direction = -1;
  }

  const confidence =
    Math.round(
      (score / maximum) * 100
    );

  return {
    ready: true,

    signal,
    direction,

    confidence:
      signal === "NO TRADE"
        ? Math.min(confidence, 49)
        : confidence,

    score,

    bullScore: bull,
    bearScore: bear,

    candleIndex: i,

    checks: {
      emaBull,
      emaBear,
      superBull,
      superBear,
      dmiBull,
      dmiBear,
      rsiBull,
      rsiBear,
      macdBull,
      macdBear,
      structureBull,
      structureBear,
      sslBull,
      sslBear,
      mtfBull,
      mtfBear
    },

    reason:
      signal === "NO TRADE"
        ? "Mandatory conditions not aligned"
        : `${signal}: ${score}/${maximum} confluence`
  };
}
