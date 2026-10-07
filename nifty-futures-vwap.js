// netlify/functions/nifty-futures-vwap.js
// PRO SCALPER - NIFTY FUTURES SESSION VWAP
//
// Purpose:
// 1. Resolve nearest non-expired NIFTY futures contract
// 2. Load genuine Upstox intraday futures candles
// 3. Calculate VWAP using REAL futures volume
// 4. Never generate fake volume or fake VWAP
//
// Token remains server-side in Netlify:
// UPSTOX_ANALYTICS_TOKEN

const IST_TIME_ZONE = 'Asia/Kolkata';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}

function istParts(value = Date.now()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(new Date(value));

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}

function todayIST() {
  const p = istParts();

  return `${p.year}-${p.month}-${p.day}`;
}

function isTodayAfter0915(timestamp) {
  const candle = istParts(timestamp);
  const today = istParts();

  const sameDate =
    candle.year === today.year &&
    candle.month === today.month &&
    candle.day === today.day;

  if (!sameDate) return false;

  const minutes =
    Number(candle.hour) * 60 +
    Number(candle.minute);

  return minutes >= 9 * 60 + 15;
}

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

  const milliseconds =
    new Date(timestamp).getTime();

  if (!Number.isFinite(milliseconds)) {
    return null;
  }

  if (!isTodayAfter0915(milliseconds)) {
    return null;
  }

  const candle = {
    time: Math.floor(milliseconds / 1000),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    openInterest: Number(openInterest) || 0,
  };

  if (
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close) ||
    !Number.isFinite(candle.volume)
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

  if (candle.volume < 0) {
    return null;
  }

  return candle;
}

function calculateVWAP(candles) {
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    if (
      !Number.isFinite(candle.volume) ||
      candle.volume <= 0
    ) {
      continue;
    }

    // Typical price:
    // (High + Low + Close) / 3

    const typicalPrice =
      (
        candle.high +
        candle.low +
        candle.close
      ) / 3;

    cumulativePV +=
      typicalPrice *
      candle.volume;

    cumulativeVolume +=
      candle.volume;
  }

  if (
    cumulativeVolume <= 0 ||
    !Number.isFinite(cumulativePV)
  ) {
    return null;
  }

  return {
    value:
      cumulativePV /
      cumulativeVolume,

    cumulativeVolume,
  };
}

function expiryTime(expiry) {
  if (!expiry) {
    return NaN;
  }

  /*
    Treat expiry date as end of the expiry day
    for sorting/filtering purposes.
  */

  return new Date(
    `${expiry}T23:59:59+05:30`
  ).getTime();
}

function chooseNearestNiftyFuture(instruments) {
  const now = Date.now();

  const matches =
    instruments
      .filter((instrument) => {
        const segment =
          String(
            instrument?.segment || ''
          ).toUpperCase();

        const type =
          String(
            instrument?.instrument_type || ''
          ).toUpperCase();

        const tradingSymbol =
          String(
            instrument?.trading_symbol || ''
          ).toUpperCase();

        const name =
          String(
            instrument?.name || ''
          ).toUpperCase();

        const underlying =
          String(
            instrument?.underlying_symbol || ''
          ).toUpperCase();

        const expiry =
          expiryTime(
            instrument?.expiry
          );

        const isFuture =
          type === 'FUT';

        const isNSEFO =
          segment === 'NSE_FO';

        const isNifty =
          underlying === 'NIFTY' ||
          name === 'NIFTY' ||
          tradingSymbol.startsWith('NIFTY');

        const notBankNifty =
          !tradingSymbol.startsWith('BANKNIFTY') &&
          underlying !== 'BANKNIFTY' &&
          name !== 'BANKNIFTY';

        return (
          isFuture &&
          isNSEFO &&
          isNifty &&
          notBankNifty &&
          Number.isFinite(expiry) &&
          expiry >= now &&
          instrument?.instrument_key
        );
      })
      .sort(
        (a, b) =>
          expiryTime(a.expiry) -
          expiryTime(b.expiry)
      );

  return matches[0] || null;
}

async function loadInstrumentMaster() {
  /*
    Upstox publishes instrument master files.
    Try the current NSE instrument JSON first.

    If Upstox changes this public file location,
    this function will return a clear unavailable
    response instead of fabricating a contract.
  */

  const urls = [
    'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz',
    'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json',
  ];

  let lastError = null;

  for (const url of urls) {
    try {
      const response =
        await fetch(url, {
          headers: {
            Accept:
              'application/json, application/gzip, */*',
          },
        });

      if (!response.ok) {
        lastError =
          new Error(
            `Instrument master HTTP ${response.status}`
          );

        continue;
      }

      /*
        Netlify fetch normally handles HTTP content
        encoding automatically when the server sends
        the correct headers.
      */

      const instruments =
        await response.json();

      if (
        Array.isArray(instruments) &&
        instruments.length
      ) {
        return instruments;
      }

      lastError =
        new Error(
          'Instrument master was empty.'
        );

    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ||
    new Error(
      'Unable to load Upstox instrument master.'
    )
  );
}

async function loadFuturesCandles(
  token,
  instrumentKey,
  interval
) {
  const endpoint =
    'https://api.upstox.com/v3/' +
    'historical-candle/intraday/' +
    encodeURIComponent(instrumentKey) +
    '/minutes/' +
    interval;

  const response =
    await fetch(endpoint, {
      method: 'GET',

      headers: {
        Authorization:
          `Bearer ${token}`,

        Accept:
          'application/json',
      },
    });

  if (!response.ok) {
    const details =
      await response
        .text()
        .catch(() => '');

    console.error(
      'NIFTY futures candle error:',
      response.status,
      details
    );

    throw new Error(
      `Upstox futures candles returned HTTP ${response.status}.`
    );
  }

  const body =
    await response.json();

  const rows =
    body?.data?.candles;

  if (!Array.isArray(rows)) {
    throw new Error(
      'Upstox did not return futures candle data.'
    );
  }

  return rows
    .map(normalizeCandle)
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.time - b.time
    );
}

export default async (request) => {
  try {
    const token =
      process.env.UPSTOX_ANALYTICS_TOKEN;

    if (!token) {
      return json({
        live: false,
        source: 'UPSTOX',
        type: 'FUTURES_VWAP',
        reason:
          'UPSTOX_ANALYTICS_TOKEN is not configured.',
      });
    }

    const url =
      new URL(request.url);

    const requestedInterval =
      Number(
        url.searchParams.get('interval') || 1
      );

    const allowedIntervals =
      [1, 3, 5, 15];

    const interval =
      allowedIntervals.includes(
        requestedInterval
      )
        ? requestedInterval
        : 1;

    /*
      STEP 1:
      Resolve current nearest-expiry NIFTY FUT.
    */

    const instruments =
      await loadInstrumentMaster();

    const contract =
      chooseNearestNiftyFuture(
        instruments
      );

    if (!contract) {
      return json({
        live: false,
        source: 'UPSTOX',
        type: 'FUTURES_VWAP',
        date: todayIST(),
        reason:
          'No active NIFTY futures contract was found.',
      });
    }

    /*
      STEP 2:
      Fetch genuine futures OHLCV.
    */

    const candles =
      await loadFuturesCandles(
        token,
        contract.instrument_key,
        interval
      );

    if (!candles.length) {
      return json({
        live: false,
        source: 'UPSTOX',
        type: 'FUTURES_VWAP',
        contract:
          contract.trading_symbol,
        expiry:
          contract.expiry,
        instrumentKey:
          contract.instrument_key,
        date:
          todayIST(),
        reason:
          'No NIFTY futures candles are available from 09:15 IST.',
      });
    }

    /*
      STEP 3:
      Calculate real-volume session VWAP.
    */

    const result =
      calculateVWAP(candles);

    if (!result) {
      return json({
        live: false,
        source: 'UPSTOX',
        type: 'FUTURES_VWAP',
        contract:
          contract.trading_symbol,
        expiry:
          contract.expiry,
        instrumentKey:
          contract.instrument_key,
        date:
          todayIST(),
        candleCount:
          candles.length,
        reason:
          'Genuine futures volume is unavailable, so VWAP cannot be calculated.',
      });
    }

    const latest =
      candles[
        candles.length - 1
      ];

    const relation =
      latest.close >
      result.value
        ? 'ABOVE'
        : latest.close <
          result.value
          ? 'BELOW'
          : 'AT';


    /*
      STEP 4:
      Return only genuine calculated data.
    */

    return json({
      live: true,

      source:
        'UPSTOX',

      type:
        'FUTURES_VWAP',

      label:
        'Futures VWAP',

      underlying:
        'NIFTY',

      contract:
        contract.trading_symbol,

      expiry:
        contract.expiry,

      instrumentKey:
        contract.instrument_key,

      date:
        todayIST(),

      timezone:
        IST_TIME_ZONE,

      sessionStart:
        '09:15',

      interval:
        `${interval}m`,

      candleCount:
        candles.length,

      futuresPrice:
        latest.close,

      vwap:
        Number(
          result.value.toFixed(2)
        ),

      relation,

      cumulativeVolume:
        result.cumulativeVolume,

      firstCandleTime:
        candles[0].time,

      lastCandleTime:
        latest.time,
    });

  } catch (error) {

    console.error(
      'nifty-futures-vwap error:',
      error
    );

    return json({
      live: false,

      source:
        'UPSTOX',

      type:
        'FUTURES_VWAP',

      reason:
        error?.message ||
        'Unable to calculate NIFTY Futures VWAP.',
    });
  }
};
