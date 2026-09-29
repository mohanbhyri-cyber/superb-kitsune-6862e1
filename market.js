// All browser-side Upstox requests share the same retry deadline.
let upstoxRetryAt = 0;

// ============================================================
// HISTORY CACHE + REQUEST DEDUPLICATION
// Prevent duplicate Upstox historical requests / HTTP 429
// ============================================================

const historyCache = new Map();
const historyInFlight = new Map();
const HISTORY_CACHE_MS = 60 * 1000;

async function cachedMarketRequest(key, requestFn, ttlMs = HISTORY_CACHE_MS) {
  const now = Date.now();
  const cached = historyCache.get(key);

  if (cached && now - cached.time < ttlMs) {
    return cached.data;
  }

  if (historyInFlight.has(key)) {
    return historyInFlight.get(key);
  }

  const promise = Promise.resolve()
    .then(requestFn)
    .then(data => {
      historyCache.set(key, {
        time: Date.now(),
        data
      });
      return data;
    })
    .finally(() => {
      historyInFlight.delete(key);
    });

  historyInFlight.set(key, promise);
  return promise;
}
function marketRateLimitError() {
  const error = new Error('Upstox rate limit reached. Waiting before retry.');
  error.status = 429;
  error.retryAfterMs = Math.max(1000, upstoxRetryAt - Date.now());
  return error;
}
async function upstoxRequest(url, options) {
  if (Date.now() < upstoxRetryAt) throw marketRateLimitError();
  const response = await fetch(url, options);
  if (response.status === 429) {
    const body = await response.clone().json().catch(() => ({}));
    const header = response.headers.get('retry-after');
    const seconds = header && Number.isFinite(Number(header))
      ? Number(header) : header ? (Date.parse(header) - Date.now()) / 1000 : 0;
    const bodyDelay = Number(body.retryAfterMs);
    const delay = Math.max(60000, Number.isFinite(bodyDelay) ? bodyDelay : 0,
      Number.isFinite(seconds) ? seconds * 1000 : 0);
    upstoxRetryAt = Math.max(upstoxRetryAt, Date.now() + delay);
    throw marketRateLimitError();
  }
  return response;
}

// market.js
// ============================================================
// PRO SCALPER — LIVE MARKET ADAPTER
// Client contains NO Upstox credentials.
// All authenticated Upstox requests must go through
// /api/*
// ============================================================

export const API_BASE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('sample') === '1'
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

  if (!values.length) return [];

  const k = 2 / (n + 1);
  let last = values[0];

  return values.map((v, i) => {

    if (i === 0) {
      last = v;
      return last;
    }

    last = v * k + last * (1 - k);

    return last;
  });
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

  const macd = e12.map((v, i) => v - e26[i]);

  const signal = ema(macd, 9);

  const hist = macd.map(
    (v, i) => v - signal[i]
  );


  // ----------------------------------------------------------
  // RSI 14
  // ----------------------------------------------------------

  let gain = 0;
  let loss = 0;

  const rsi = close.map((v, i) => {

    if (!i) return null;

    const d = v - close[i - 1];

    if (i <= 14) {

      gain += Math.max(d, 0) / 14;
      loss += Math.max(-d, 0) / 14;

    } else {

      gain =
        (gain * 13 + Math.max(d, 0)) / 14;

      loss =
        (loss * 13 + Math.max(-d, 0)) / 14;
    }

    if (i < 14) return null;

    if (loss === 0) {
      return gain === 0 ? 50 : 100;
    }

    return 100 - 100 / (1 + gain / loss);
  });


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

    this.status = 'CONNECTING';

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
      throw new Error('Unsupported timeframe');
    }

    const cacheKey = `history:${symbol}:${timeframe}`;

    return cachedMarketRequest(cacheKey, async () => {

      this.status = 'CONNECTING';

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
          { cache: 'no-store' }
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

      const data = await response.json();

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
          .sort((a, b) => a.time - b.time);

      if (!candles.length) {
        this.status = 'OFFLINE';
        throw new Error(
          'No live candles returned'
        );
      }

      if (candles.length < 221) {
        this.status = 'WARMING UP';
        throw new Error(
          `Insufficient Upstox history: ${candles.length}/221 candles. Signals and replay remain disabled.`
        );
      }

      const byTime = new Map();
      for (const candle of candles) {
        byTime.set(candle.time, candle);
      }

      const latest =
        [...byTime.values()]
          .sort((a, b) => a.time - b.time)
          .slice(-500);

      this.status = 'LIVE';
      this.lastUpdate = Date.now();

      console.log(
        `[SMRT HISTORY] ${symbol} ${timeframe}: ${latest.length} candles`
      );

      return latest;
    });
  }


  async mtfHistory(symbol, timeframe) {

    if (!['5m', '15m', '1h'].includes(timeframe)) {
      return [];
    }

    const cacheKey = `mtf:${symbol}:${timeframe}`;

    try {
      return await cachedMarketRequest(cacheKey, async () => {
        const controller = new AbortController();

        const timeout = setTimeout(
          () => controller.abort(),
          8000
        );

        let response;

        try {
          response = await upstoxRequest(
            API_BASE + '/api/upstox-mtf-history' +
            '?symbol=' +
            encodeURIComponent(symbol) +
            '&timeframe=' +
            encodeURIComponent(timeframe),
            {
              cache: 'no-store',
              signal: controller.signal
            }
          );
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          if (response.status === 429) {
            throw marketRateLimitError();
          }
          return [];
        }

        const data = await response.json();

        if (
          data?.live !== true ||
          !Array.isArray(data?.candles)
        ) {
          return [];
        }

        const byTime = new Map();

        data.candles
          .map(normalizeCandle)
          .filter(Boolean)
          .forEach(candle => {
            byTime.set(candle.time, candle);
          });

        const candles =
          [...byTime.values()]
            .sort((a, b) => a.time - b.time)
            .slice(-500);

        console.log(
          `[SMRT MTF] ${symbol} ${timeframe}: ${candles.length} candles`
        );

        return candles;
      }, 5 * 60 * 1000);

    } catch (error) {
      console.warn(
        'MTF history unavailable:',
        timeframe,
        error
      );

      if (error?.status === 429) throw error;
      return [];
    }
  }


  async previousHistory(symbol, timeframe) {

    if (!intervals[timeframe]) {
      return [];
    }

    const cacheKey = `previous:${symbol}:${timeframe}`;

    try {
      return await cachedMarketRequest(cacheKey, async () => {
        const response = await upstoxRequest(
          API_BASE + '/api/upstox-previous-history' +
          '?symbol=' +
          encodeURIComponent(symbol) +
          '&timeframe=' +
          encodeURIComponent(timeframe),
          {
            cache: 'no-store'
          }
        );

        if (!response.ok) {
          if (response.status === 429) {
            throw marketRateLimitError();
          }
          return [];
        }

        const data = await response.json();

        if (!Array.isArray(data?.candles)) {
          return [];
        }

        const byTime = new Map();

        data.candles
          .map(normalizeCandle)
          .filter(Boolean)
          .forEach(candle => {
            byTime.set(candle.time, candle);
          });

        const candles =
          [...byTime.values()]
            .sort((a, b) => a.time - b.time)
            .slice(-500);

        console.log(
          `[SMRT PREVIOUS] ${symbol} ${timeframe}: ${candles.length} candles`
        );

        return candles;
      });

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
  // Polling current Cloudflare route every 3 seconds.
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

    this.status = 'CONNECTING';


    const tick = async () => {

      if (!alive || inFlight) return;
      if (document.hidden) return;
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
            }
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
          )
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

        if (
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
        if (alive && !document.hidden) {
          const retryDelay =
  consecutiveFailures >= 3
    ? 30000
    : consecutiveFailures > 0
      ? 10000
      : 5000;

timer = setTimeout(
  tick,
  Math.max(retryDelay, upstoxRetryAt - Date.now())
);
        }
      }
    };

    const resume = () => {
      if (!document.hidden && alive && !inFlight && timer === null) tick();
      if (document.hidden) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener('visibilitychange', resume);

    tick();


    return () => {

      alive = false;

      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);

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

const sampleMode =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('sample') === '1';

function sampleCandles(timeframe, count = 500, endTime = Date.now() / 1000) {
  const seconds = intervals[timeframe] || 60;
  const currentOpen = Math.floor(Number(endTime) / seconds) * seconds;
  const firstTime = currentOpen - (count - 1) * seconds;
  const candles = Array.from({ length: count }, (_, index) => {
    const close = 23200 + index * 0.15 + index * index * 0.001;
    const open = close - 3;
    return {
      time: firstTime + index * seconds,
      open,
      high: close + 1,
      low: open - 1,
      close,
      volume: 90000 + (index % 37) * 4200,
      openInterest: 0
    };
  });

  // Closed-candle fixtures near the end exercise the same Prime structure,
  // order-block, FVG, and liquidity-sweep rules used for live data.
  const fixture = [
    [23512, 23515, 23517, 23511],
    [23515, 23514, 23516, 23512],
    [23514, 23513, 23515, 23511],
    [23514, 23511, 23515, 23510],
    [23512, 23510, 23513, 23508],
    [23510, 23512, 23514, 23510],
    [23512, 23514, 23516, 23512],
    [23514, 23515, 23516, 23514],
    [23514, 23520, 23521, 23507],
    [23520, 23522, 23523, 23518],
    [23522, 23524, 23525, 23520],
    [23524, 23526, 23527, 23522],
    [23526, 23528, 23529, 23524]
  ];
  const start = Math.max(0, count - fixture.length - 1);
  fixture.forEach(([open, close, high, low], offset) => {
    const index = start + offset;
    if (!candles[index]) return;
    candles[index] = {
      ...candles[index],
      open,
      high,
      low,
      close,
      volume: 165000 + offset * 6000
    };
  });

  return candles;
}

class SampleMarketAdapter {
  constructor() {
    this.status = 'SAMPLE';
    this.lastUpdate = Date.now();
    this.quotes = {};
  }

  async history(_symbol, timeframe) {
    return sampleCandles(timeframe, 500);
  }

  async mtfHistory(_symbol, timeframe) {
    return sampleCandles(timeframe, 320);
  }

  async previousHistory(_symbol, timeframe) {
    const seconds = intervals[timeframe] || 60;
    return sampleCandles(timeframe, 320, Date.now() / 1000 - 500 * seconds);
  }

  subscribe(symbol, timeframe, onTick) {
    let active = true;
    const seconds = intervals[timeframe] || 60;
    const emit = () => {
      if (!active) return;
      const now = Date.now() / 1000;
      const phase = now / 18;
      const price = 23410 + Math.sin(phase) * 12 + Math.sin(phase / 4) * 18;
      this.quotes[symbol] = price;
      this.lastUpdate = Date.now();
      onTick?.({
        time: Math.floor(now),
        price,
        delta: Math.cos(phase) * 0.6,
        volume: 125000,
        previousClose: 23375,
        netChange: price - 23375,
        changePercent: ((price - 23375) / 23375) * 100,
        live: true,
        fallback: false,
        source: 'DETERMINISTIC SAMPLE',
        candleTime: Math.floor(now / seconds) * seconds
      });
    };
    emit();
    const timer = setInterval(emit, 2000);
    return () => {
      active = false;
      clearInterval(timer);
      this.status = 'DISCONNECTED';
    };
  }
}

export const market = sampleMode
  ? new SampleMarketAdapter()
  : new UpstoxMarketAdapter();


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
