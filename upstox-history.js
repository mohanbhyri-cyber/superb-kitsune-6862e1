// netlify/functions/upstox-history.js
// PRO SCALPER - REAL UPSTOX INTRADAY HISTORY
// No demo/random candles.
// Upstox token stays on Netlify server.

const keys = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
};

const timeframeMap = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
};

function sendJSON(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}

// ------------------------------------------------------------
// Convert a timestamp into IST date/time parts
// ------------------------------------------------------------

function getISTParts(timestamp) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(new Date(timestamp));

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}

// ------------------------------------------------------------
// Keep only TODAY'S candles starting from 09:15 IST
// ------------------------------------------------------------

function isTodayFrom0915(timestamp) {
  const candle = getISTParts(timestamp);
  const today = getISTParts(Date.now());

  const sameDate =
    candle.year === today.year &&
    candle.month === today.month &&
    candle.day === today.day;

  if (!sameDate) {
    return false;
  }

  const candleMinutes =
    Number(candle.hour) * 60 +
    Number(candle.minute);

  const marketStart = 9 * 60 + 15;

  return candleMinutes >= marketStart;
}

// ------------------------------------------------------------
// Convert Upstox candle array into our standard candle object
//
// Upstox:
// [
//   timestamp,
//   open,
//   high,
//   low,
//   close,
//   volume,
//   openInterest
// ]
// ------------------------------------------------------------

function normalizeCandle(row) {
  if (!Array.isArray(row) || row.length < 6) {
    return null;
  }

  const [
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    openInterest,
  ] = row;

  const milliseconds = new Date(timestamp).getTime();

  if (!Number.isFinite(milliseconds)) {
    return null;
  }

  const candle = {
    time: Math.floor(milliseconds / 1000),

    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),

    volume: Number(volume) || 0,

    openInterest:
      Number(openInterest) || 0,
  };

  // ----------------------------------------------------------
  // Reject invalid numeric data
  // ----------------------------------------------------------

  if (
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close)
  ) {
    return null;
  }

  if (
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // Reject malformed OHLC
  // ----------------------------------------------------------

  if (
    candle.high < candle.low ||
    candle.high < candle.open ||
    candle.high < candle.close ||
    candle.low > candle.open ||
    candle.low > candle.close
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // Today's session only - starting 09:15 IST
  // ----------------------------------------------------------

  if (!isTodayFrom0915(milliseconds)) {
    return null;
  }

  return candle;
}

// ------------------------------------------------------------
// NETLIFY FUNCTION
// ------------------------------------------------------------

export default async (request) => {
  try {
    const requestURL = new URL(request.url);

    const symbol = (
      requestURL.searchParams.get('symbol') ||
      'NIFTY'
    ).toUpperCase();

    const timeframe =
      requestURL.searchParams.get('timeframe') ||
      '1m';

    const instrumentKey =
      keys[symbol];

    const interval =
      timeframeMap[timeframe];

    const token =
      process.env.UPSTOX_ANALYTICS_TOKEN;

    // --------------------------------------------------------
    // Validate instrument
    // --------------------------------------------------------

    if (!instrumentKey) {
      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason: 'Unsupported instrument.',
        candles: [],
      });
    }

    // --------------------------------------------------------
    // Validate timeframe
    // --------------------------------------------------------

    if (!interval) {
      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason: 'Unsupported timeframe.',
        candles: [],
      });
    }

    // --------------------------------------------------------
    // Check token
    // --------------------------------------------------------

    if (!token) {
      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason:
          'UPSTOX_ANALYTICS_TOKEN is not configured.',
        candles: [],
      });
    }

    // --------------------------------------------------------
    // Upstox V3 intraday candle endpoint
    // --------------------------------------------------------

    const endpoint =
      'https://api.upstox.com/v3/historical-candle/intraday/' +
      encodeURIComponent(instrumentKey) +
      '/minutes/' +
      interval;

    // --------------------------------------------------------
    // Request REAL candles from Upstox
    // --------------------------------------------------------

    const response = await fetch(endpoint, {
      method: 'GET',

      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    // --------------------------------------------------------
    // Upstox error
    // --------------------------------------------------------

    if (!response.ok) {
      let details = '';

      try {
        details = await response.text();
      } catch {
        details = '';
      }

      console.error(
        'Upstox history request failed:',
        response.status,
        details
      );

      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason:
          `Upstox returned HTTP ${response.status}.`,
        candles: [],
      });
    }

    // --------------------------------------------------------
    // Read response
    // --------------------------------------------------------

    const body =
      await response.json();

    const rawCandles =
      body?.data?.candles;

    if (!Array.isArray(rawCandles)) {
      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason:
          'Upstox did not return candle data.',
        candles: [],
      });
    }

    // --------------------------------------------------------
    // Normalize + validate + sort
    // --------------------------------------------------------

    let candles =
      rawCandles
        .map(normalizeCandle)
        .filter(Boolean)
        .sort(
          (a, b) =>
            a.time - b.time
        );

    // --------------------------------------------------------
    // Remove duplicate candle timestamps
    // --------------------------------------------------------

    const uniqueCandles = [];

    for (const candle of candles) {
      const previous =
        uniqueCandles[
          uniqueCandles.length - 1
        ];

      if (
        previous &&
        previous.time === candle.time
      ) {
        uniqueCandles[
          uniqueCandles.length - 1
        ] = candle;
      } else {
        uniqueCandles.push(candle);
      }
    }

    candles = uniqueCandles;

    // --------------------------------------------------------
    // Nothing returned for current trading session
    // --------------------------------------------------------

    if (!candles.length) {
      return sendJSON({
        live: false,

        source: 'UPSTOX',

        symbol,
        timeframe,

        sessionStart: '09:15',

        timezone:
          'Asia/Kolkata',

        reason:
          'No candles available for today from 09:15 IST.',

        candles: [],
      });
    }

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    return sendJSON({
      live: true,

      source: 'UPSTOX',

      symbol,
      timeframe,

      instrumentKey,

      sessionStart: '09:15',

      timezone:
        'Asia/Kolkata',

      count:
        candles.length,

      firstCandleTime:
        candles[0]?.time ??
        null,

      lastCandleTime:
        candles[
          candles.length - 1
        ]?.time ??
        null,

      candles,
    });
  } catch (error) {
    console.error(
      'upstox-history error:',
      error
    );

    return sendJSON({
      live: false,

      source: 'UPSTOX',

      reason:
        error?.message ||
        'Unable to load Upstox intraday candles.',

      candles: [],
    });
  }
};
