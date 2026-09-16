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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });

function getISTParts(timestamp) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));

  return Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );
}

function isTodayFrom0915(timestamp) {
  const candle = getISTParts(timestamp);
  const now = getISTParts(Date.now());

  const sameDay =
    candle.year === now.year &&
    candle.month === now.month &&
    candle.day === now.day;

  if (!sameDay) {
    return false;
  }

  const minutes =
    Number(candle.hour) * 60 +
    Number(candle.minute);

  return minutes >= 9 * 60 + 15;
}

export default async (request) => {
  try {
    const url = new URL(request.url);

    const symbol =
      url.searchParams.get('symbol') || 'NIFTY';

    const timeframe =
      url.searchParams.get('timeframe') || '1m';

    const instrumentKey =
      keys[symbol];

    const interval =
      timeframeMap[timeframe];

    const token =
      process.env.UPSTOX_ANALYTICS_TOKEN;

    if (!instrumentKey) {
      return json({
        live: false,
        reason: 'Unsupported instrument.',
        candles: [],
      });
    }

    if (!interval) {
      return json({
        live: false,
        reason: 'Unsupported timeframe.',
        candles: [],
      });
    }

    if (!token) {
      return json({
        live: false,
        reason: 'UPSTOX_ANALYTICS_TOKEN is not configured.',
        candles: [],
      });
    }

    const endpoint =
      'https://api.upstox.com/v3/historical-candle/intraday/' +
      encodeURIComponent(instrumentKey) +
      '/minutes/' +
      interval;

    const response = await fetch(endpoint, {
      method: 'GET',

      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      let details = '';

      try {
        details = await response.text();
      } catch {
        details = '';
      }

      console.error(
        'Upstox history error:',
        response.status,
        details
      );

      return json({
        live: false,
        reason: `Upstox returned ${response.status}.`,
        candles: [],
      });
    }

    const body =
      await response.json();

    const raw =
      body?.data?.candles;

    if (!Array.isArray(raw)) {
      return json({
        live: false,
        reason: 'Upstox returned no candle data.',
        candles: [],
      });
    }

    const candles = raw
      .map(row => {
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

        const ms =
          new Date(timestamp).getTime();

        if (!Number.isFinite(ms)) {
          return null;
        }

        const candle = {
          time: Math.floor(ms / 1000),
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume) || 0,
          openInterest:
            Number(openInterest) || 0,
        };

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

        if (
          candle.high < candle.low ||
          candle.high < candle.open ||
          candle.high < candle.close ||
          candle.low > candle.open ||
          candle.low > candle.close
        ) {
          return null;
        }

        if (!isTodayFrom0915(ms)) {
          return null;
        }

        return candle;
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);

    const unique = [];

    for (const candle of candles) {
      const previous =
        unique[unique.length - 1];

      if (
        previous &&
        previous.time === candle.time
      ) {
        unique[unique.length - 1] =
          candle;
      } else {
        unique.push(candle);
      }
    }

    if (!unique.length) {
      return json({
        live: false,
        reason:
          'No candles available for today from 09:15 IST.',
        symbol,
        timeframe,
        candles: [],
      });
    }

    return json({
      live: true,

      source: 'UPSTOX',

      symbol,

      timeframe,

      instrumentKey,

      sessionStart: '09:15',

      timezone: 'Asia/Kolkata',

      count: unique.length,

      candles: unique,
    });
  } catch (error) {
    console.error(
      'upstox-history function error:',
      error
    );

    return json({
      live: false,
      reason: 'Unable to load Upstox intraday candles.',
      candles: [],
    });
  }
};
