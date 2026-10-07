import { marketRequest, browserCooldownRemaining, browserNoteRateLimit } from './request-coordinator.js';
export const upstoxCooldownRemaining = browserCooldownRemaining;
export const noteUpstoxRateLimit = browserNoteRateLimit;
const upstoxRequest = marketRequest;

// market.js
// ============================================================
// PRO SCALPER — LIVE MARKET ADAPTER
// Client contains NO Upstox credentials.
// All authenticated Upstox requests must go through
// /api/*
// ============================================================

export const API_BASE =
  typeof window !== 'undefined' &&
  false
    ? ''
    : typeof window !== 'undefined' &&
  ['127.0.0.1', 'localhost'].includes(
    window.location.hostname
  )
    ? 'https://superb-kitsune-6862e1.mohanbhyri.workers.dev'
    : '';


export const instruments = [
  {
    id: 'NIFTY',
    name: 'NIFTY 50',
    kind: 'INDEX',
    description: 'Nifty 50 Index'
  }
];

export const intervals = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1D': 86400
};


// ============================================================
// BASIC INDICATORS
// ============================================================

export function sma(values, n) {
  let sum = 0;

  return values.map((v, i) => {
    sum += v;

    if (i >= n) {
      sum -= values[i - n];
    }

    return i >= n - 1 ? sum / n : null;
  });
}


export function ema(values, n) {
  const input = Array.isArray(values)
    ? values.map(Number)
    : [];

  const out = Array(input.length).fill(null);

  if (
    !Number.isInteger(n) ||
    n < 1 ||
    input.length < n ||
    input.some(value => !Number.isFinite(value))
  ) {
    return out;
  }

  // Seed with the first n-period SMA. This prevents partially warmed
  // EMA/MACD values from being treated as confirmed indicator data.
  let seed = 0;
  for (let i = 0; i < n; i++) {
    seed += input[i];
  }

  let last = seed / n;
  out[n - 1] = last;

  const k = 2 / (n + 1);

  for (let i = n; i < input.length; i++) {
    last = input[i] * k + last * (1 - k);
    out[i] = last;
  }

  return out;
}


// ============================================================
// INDICATORS
// EMA 9 / 21 / 50 / 200
// RSI 14
// MACD 12 / 26 / 9
// Bollinger Bands
// Session VWAP
// ============================================================

export function indicators(candles) {

  if (!Array.isArray(candles) || !candles.length) {
    return {
      s50: [],
      s200: [],
      e200: [],
      e9: [],
      e21: [],
      e50: [],
      rsi: [],
      macd: [],
      signal: [],
      hist: [],
      bb: [],
      vwap: []
    };
  }

  const close = candles.map(c => Number(c.close));

  const e9 = ema(close, 9);
  const e21 = ema(close, 21);
  const e50 = ema(close, 50);
  const e200 = ema(close, 200);

  const e12 = ema(close, 12);
  const e26 = ema(close, 26);

  const macd = close.map((_, i) =>
    Number.isFinite(Number(e12[i])) &&
    Number.isFinite(Number(e26[i]))
      ? Number(e12[i]) - Number(e26[i])
      : null
  );

  // MACD signal EMA starts only after nine valid MACD values exist.
  const validMacd = macd.filter(value => Number.isFinite(Number(value)));
  const validSignal = ema(validMacd, 9);
  const signal = Array(macd.length).fill(null);
  let signalIndex = 0;

  for (let i = 0; i < macd.length; i++) {
    if (!Number.isFinite(Number(macd[i]))) continue;
    signal[i] = validSignal[signalIndex] ?? null;
    signalIndex += 1;
  }

  const hist = macd.map((v, i) =>
    Number.isFinite(Number(v)) &&
    Number.isFinite(Number(signal[i]))
      ? Number(v) - Number(signal[i])
      : null
  );


  // ----------------------------------------------------------
  // RSI 14
  // ----------------------------------------------------------

  const rsiPeriod = 14;
  const rsi = Array(close.length).fill(null);

  if (close.length > rsiPeriod) {
    let gainSum = 0;
    let lossSum = 0;

    // Wilder seed: average the first 14 price changes.
    for (let i = 1; i <= rsiPeriod; i++) {
      const change = close[i] - close[i - 1];
      gainSum += Math.max(change, 0);
      lossSum += Math.max(-change, 0);
    }

    let averageGain = gainSum / rsiPeriod;
    let averageLoss = lossSum / rsiPeriod;

    const rsiValue = () => {
      if (averageLoss === 0) {
        return averageGain === 0 ? 50 : 100;
      }

      const rs = averageGain / averageLoss;
      return 100 - 100 / (1 + rs);
    };

    rsi[rsiPeriod] = rsiValue();

    for (let i = rsiPeriod + 1; i < close.length; i++) {
      const change = close[i] - close[i - 1];
      const currentGain = Math.max(change, 0);
      const currentLoss = Math.max(-change, 0);

      averageGain =
        (averageGain * (rsiPeriod - 1) + currentGain) /
        rsiPeriod;

      averageLoss =
        (averageLoss * (rsiPeriod - 1) + currentLoss) /
        rsiPeriod;

      rsi[i] = rsiValue();
    }
  }


  // ----------------------------------------------------------
  // BOLLINGER BANDS
  // ----------------------------------------------------------

  const bb = close.map((v, i) => {

    if (i < 19) return null;

    const a =
      close.slice(i - 19, i + 1);

    const m =
      a.reduce((s, x) => s + x, 0) / 20;

    const sd = Math.sqrt(
      a.reduce(
        (s, x) => s + (x - m) ** 2,
        0
      ) / 20
    );

    return {
      mid: m,
      upper: m + 2 * sd,
      lower: m - 2 * sd
    };
  });


  // ----------------------------------------------------------
  // SESSION VWAP
  // ----------------------------------------------------------

  let totalV = 0;
  let totalPV = 0;
  let sessionDay = '';

  const vwap = candles.map(c => {

    const date =
      new Date(c.time * 1000);

    const day =
      new Intl.DateTimeFormat(
        'en-CA',
        {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }
      ).format(date);

    if (day !== sessionDay) {

      sessionDay = day;
      totalV = 0;
      totalPV = 0;
    }

    const volume =
      Number(c.volume) || 0;

    const typical =
      (
        Number(c.high) +
        Number(c.low) +
        Number(c.close)
      ) / 3;

    totalV += volume;
    totalPV += typical * volume;

    return totalV
      ? totalPV / totalV
      : null;
  });


  return {

    s50: sma(close, 50),

    s200: sma(close, 200),

    e200,

    e9,

    e21,

    e50,

    rsi,

    macd,

    signal,

    hist,

    bb,

    vwap
  };
}


// ============================================================
// CANDLE VALIDATION
// Prevent malformed candles such as:
// O 24830 / H 24843 / L 23213 / C 23214
// ============================================================

export function validCandle(c) {

  if (!c) return false;

  const time = Number(c.time);
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);

  if (
    !Number.isFinite(time) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return false;
  }

  if (
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0
  ) {
    return false;
  }

  if (
    high < low ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {
    return false;
  }

  return true;
}


// ============================================================
// NORMALIZE CANDLE
// ============================================================

function normalizeCandle(c) {

  const candle = {

    time: Number(c.time),

    open: Number(c.open),

    high: Number(c.high),

    low: Number(c.low),

    close: Number(c.close),

    volume:
      Number(c.volume) || 0
  };

  return validCandle(candle)
    ? candle
    : null;
}


// ============================================================
// LIVE UPSTOX MARKET ADAPTER
//
// Backend endpoints expected:
//
// /api/upstox-history
// /api/live-quote
//
// NO random/demo fallback.
// ============================================================

export class UpstoxMarketAdapter {

  constructor() {

    this.status = 'DISCONNECTED';

    this.lastUpdate = null;

    this.quotes = {};
  }


  // ----------------------------------------------------------
  // CURRENT + PREVIOUS TRADING SESSION HISTORY
  //
  // Backend should return:
  //
  // {
  //   live: true,
  //   candles: [
//   //     {
//   //       time: 123,
//   //       open: ...,
//   //       high: ...,
//   //       low: ...,
//   //       close: ...,
//   //       volume: ...
//   //     }
//   //   ]
//   // }
// ----------------------------------------------------------

  async history(symbol, timeframe) {

    if (!intervals[timeframe]) {
      throw new Error(
        'Unsupported timeframe'
      );
    }

    this.status = 'LOADING_HISTORY';

    const url =
      API_BASE + '/api/upstox-history' +
      '?symbol=' +
      encodeURIComponent(symbol) +
      '&timeframe=' +
      encodeURIComponent(timeframe);

    let response;

    try {

      response = await upstoxRequest(
        url,
        {
          cache: 'no-store'
        },
        'history'
      );

    } catch (error) {

      if (error?.status === 429) {
        this.status = 'RATE LIMITED';
        throw error;
      }
      this.status = 'OFFLINE';

      throw new Error(
        'Unable to connect to live market history'
      );
    }


    if (!response.ok) {

      this.status = 'OFFLINE';

      throw new Error(
        'Upstox history request failed'
      );
    }


    const data =
      await response.json();


    if (
      !data ||
      data.live !== true ||
      !Array.isArray(data.candles)
    ) {

      this.status = 'OFFLINE';

      throw new Error(
        data?.reason ||
        'Live candle data unavailable'
      );
    }


    const candles =
      data.candles
        .map(normalizeCandle)
        .filter(Boolean)
        .sort(
          (a, b) =>
            a.time - b.time
        );


    if (!candles.length) {

      this.status = 'OFFLINE';

      throw new Error(
        'No live candles returned'
      );
    }


    // --------------------------------------------------------
    // Remove duplicates
    // --------------------------------------------------------

    const unique = [];

    let previousTime = null;

    for (const candle of candles) {

      if (
        candle.time === previousTime
      ) {

        unique[unique.length - 1] =
          candle;

      } else {

        unique.push(candle);

        previousTime =
          candle.time;
      }
    }


    this.status = 'LIVE';

    this.lastUpdate =
      Date.now();


    return unique;
  }


  async mtfHistory(symbol, timeframe) {

    if (
      ![
        '5m',
        '15m',
        '1h'
      ].includes(timeframe)
    ) {
      return [];
    }

    try {
      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          20000
        );

      const response =
        await upstoxRequest(
          API_BASE + '/api/upstox-mtf-history' +
            '?symbol=' +
            encodeURIComponent(symbol) +
             '&timeframe=' +
             encodeURIComponent(timeframe) +
             '&count=260',
          {
            cache: 'no-store',
            signal:
              controller.signal
          },
          'mtfHistory'
        ).finally(
          () =>
            clearTimeout(
              timeout
            )
        );

      if (!response.ok) {
        return [];
      }

      const data =
        await response.json();

      if (
        data?.live !== true ||
        !Array.isArray(
          data?.candles
        )
      ) {
        return [];
      }

      return data.candles
        .map(normalizeCandle)
        .filter(Boolean)
        .sort(
          (x, y) =>
            x.time - y.time
        );

    } catch (error) {
      console.warn(
        'MTF history unavailable:',
        timeframe,
        error
      );

      return [];
    }
  }


  async previousHistory(symbol, timeframe) {

    if (!intervals[timeframe]) {
      return [];
    }

    try {
      const response =
        await upstoxRequest(
          API_BASE + '/api/upstox-previous-history' +
          '?symbol=' +
          encodeURIComponent(symbol) +
          '&timeframe=' +
          encodeURIComponent(timeframe),
          {
            cache: 'no-store'
          },
          'previousHistory'
        );

      if (!response.ok) {
        return [];
      }

      const data =
        await response.json();

      if (data?.live !== true || !Array.isArray(data?.candles)) {
        return [];
      }

      return data.candles
        .map(normalizeCandle)
        .filter(Boolean)
        .sort(
          (a, b) =>
            a.time - b.time
        );

    } catch (error) {
      console.warn(
        'Previous-session history unavailable:',
        error
      );

      return [];
    }
  }


  // ----------------------------------------------------------
  // LIVE QUOTE SUBSCRIPTION
  //
  // Shared quote requests; adaptive polling starts at 15 seconds.
  //
  // IMPORTANT:
  // There is NO Math.random fallback.
  // ----------------------------------------------------------

  subscribe(
    symbol,
    timeframe,
    onTick,
    onError
  ) {

    let alive = true;
    let timer = null;
    let inFlight = false;

    let last = null;
    let consecutiveFailures = 0;
    let pollingDelay = 15000;

    this.status = 'CONNECTING';


    const tick = async () => {

      if (!alive || inFlight) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      inFlight = true;
      timer = null;


      try {

        const response =
          await upstoxRequest(
            API_BASE + '/api/live-quote' +
            '?symbol=' +
            encodeURIComponent(symbol),
            {
              cache: 'no-store'
            },
            'quote'
          );


        if (!response.ok) {

          throw new Error(
            'Live quote request failed'
          );
        }


        const q =
          await response.json();


        if (
          !q ||
          q.live !== true ||
          !Number.isFinite(
            Number(q.price)
          ) || Number(q.price) <= 0
        ) {

          throw new Error(
            q?.reason ||
            'Invalid live quote'
          );
        }


        const price =
          Number(q.price);


        let delta = 0;

        if (
          Number.isFinite(last)
        ) {

          delta =
            price - last;
        }


        last = price;

        this.quotes[symbol] =
          price;

        consecutiveFailures = 0;
        pollingDelay = Math.max(15000, pollingDelay * 0.9);

        this.status = 'LIVE';

        this.lastUpdate =
          Date.now();


        onTick?.({

          time:
            Number(q.time) ||
            Math.floor(
              Date.now() / 1000
            ),

          price,

          delta,

          volume:
            Number(q.volume) || 0,

          changePercent:
            Number.isFinite(
              Number(q.changePercent)
            )
              ? Number(q.changePercent)
              : null,

          netChange:
            Number.isFinite(
              Number(q.netChange)
            )
              ? Number(q.netChange)
              : null,

          previousClose:
            Number.isFinite(
              Number(q.previousClose)
            )
              ? Number(q.previousClose)
              : null,

          live: true,

          fallback:
            q.fallback === true,

          source:
            q.source || 'UPSTOX'
        });


      } catch (error) {

        consecutiveFailures +=
          1;
        pollingDelay = Math.min(120000, pollingDelay * 2);

        if (error?.status === 429) {

          this.status =
            'RATE LIMITED';

          onError?.(error);

        } else if (
          consecutiveFailures >= 3
        ) {

          this.status =
            'RECONNECTING';

          onError?.(error);
        }

        // IMPORTANT:
        // NO fake tick.
        // NO Math.random().
        // NO demo price.
      } finally {
        inFlight = false;
        if (alive && (typeof document === 'undefined' || !document.hidden)) {
          const retryDelay =
            upstoxCooldownRemaining('quote') > 0
              ? upstoxCooldownRemaining('quote')
              : pollingDelay;

          timer = setTimeout(
            tick,
            Math.max(1000, retryDelay)
          );
        }
      }
    };

    const resume = () => {
      if (typeof document === 'undefined') return;
      if (!document.hidden && alive && !inFlight && timer === null) tick();
      if (document.hidden) {
        clearTimeout(timer);
        timer = null;
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', resume);
    }

    tick();


    return () => {

      alive = false;

      clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', resume);
      }

      this.status =
        'DISCONNECTED';
    };
  }
}


// ============================================================
// ACTIVE MARKET
//
// THIS IS NOW LIVE.
//
// DemoMarketAdapter is intentionally NOT used.
// ============================================================

export const market = new UpstoxMarketAdapter();

// ============================================================
// STRIDE SIGNALS
//
// Uses closed bars only.
// This prevents signals changing/repainting during the
// unfinished candle.
// ============================================================

export function strideSignals(
  candles,
  {
    period = 14,
    multiplier = 2.5,
    closedCount =
      Math.max(
        0,
        candles.length - 1
      )
  } = {}
) {

  if (
    !Number.isInteger(period) ||
    period < 2 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    !Number.isInteger(closedCount) ||
    closedCount < 0 ||
    closedCount > candles.length
  ) {

    throw new Error(
      'Invalid signal settings'
    );
  }


  const result =
    Array(candles.length)
      .fill(null);


  let atr = 0;

  let stop = null;

  let direction = 0;


  for (
    let i = 0;
    i < closedCount;
    i++
  ) {

    const c =
      candles[i];


    if (!validCandle(c)) {
      continue;
    }


    const previousClose =
      i
        ? candles[i - 1].close
        : c.close;


    const tr =
      Math.max(

        c.high - c.low,

        Math.abs(
          c.high -
          previousClose
        ),

        Math.abs(
          c.low -
          previousClose
        )
      );


    if (i < period) {

      atr +=
        tr / period;

    } else {

      atr =
        (
          atr *
          (period - 1) +
          tr
        ) / period;
    }


    if (
      i <
      period - 1
    ) {
      continue;
    }


    const distance =
      atr * multiplier;


    let signal = null;


    if (stop === null) {

      direction =
        c.close >=
        candles[
          i -
          period +
          1
        ].close
          ? 1
          : -1;


      stop =
        c.close -
        direction *
        distance;


    } else if (
      direction === 1 &&
      c.close < stop
    ) {

      direction = -1;

      stop =
        c.close +
        distance;

      signal = 'Sell';


    } else if (
      direction === -1 &&
      c.close > stop
    ) {

      direction = 1;

      stop =
        c.close -
        distance;

      signal = 'Buy';


    } else {

      stop =
        direction === 1

          ? Math.max(
              stop,
              c.close -
              distance
            )

          : Math.min(
              stop,
              c.close +
              distance
            );
    }


    result[i] = {

      time:
        c.time,

      atr,

      stop,

      direction,

      signal
    };
  }


  return result;
}
