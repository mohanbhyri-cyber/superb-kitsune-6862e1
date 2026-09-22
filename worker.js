// worker.js
// PRO SCALPER - CLOUDFLARE WORKER
// Real Upstox data only. No demo/random fallback.

const SYMBOLS = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
};

const TIMEFRAMES = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "15m": 15,
};

const IST = "Asia/Kolkata";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

function getISTParts(value = Date.now()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date(value));

  return Object.fromEntries(
    parts
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
}

function todayIST() {
  const p = getISTParts();

  return `${p.year}-${p.month}-${p.day}`;
}

function isTodayFrom0915(value) {
  const candle = getISTParts(value);
  const today = getISTParts();

  const sameDay =
    candle.year === today.year &&
    candle.month === today.month &&
    candle.day === today.day;

  if (!sameDay) return false;

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

  const ms = new Date(timestamp).getTime();

  if (!Number.isFinite(ms)) return null;
  if (!isTodayFrom0915(ms)) return null;

  const candle = {
    time: Math.floor(ms / 1000),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume) || 0,
    openInterest: Number(openInterest) || 0,
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

  return candle;
}

async function upstoxFetch(endpoint, token) {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");

    console.error(
      "Upstox error",
      response.status,
      details
    );

    throw new Error(
      `Upstox returned HTTP ${response.status}.`
    );
  }

  return response.json();
}

// ----------------------------------------------------
// LIVE QUOTE
// ----------------------------------------------------

async function liveQuote(url, token) {
  const symbol =
    (url.searchParams.get("symbol") || "NIFTY")
      .toUpperCase();

  const instrumentKey = SYMBOLS[symbol];

  if (!instrumentKey) {
    return json({
      live: false,
      source: "UPSTOX",
      reason: "Unsupported instrument.",
    });
  }

  const endpoint =
    "https://api.upstox.com/v2/market-quote/ltp" +
    "?instrument_key=" +
    encodeURIComponent(instrumentKey);

  try {
    const body = await upstoxFetch(endpoint, token);

    const quote =
      Object.values(body?.data ?? {})[0];

    const price =
      Number(quote?.last_price);

    if (!Number.isFinite(price)) {
      return json({
        live: false,
        source: "UPSTOX",
        reason: "Upstox returned an invalid price.",
      });
    }

    return json({
      live: true,
      source: "UPSTOX",
      symbol,
      instrumentKey,
      price,
      time: Math.floor(Date.now() / 1000),
      timestamp:
        quote?.timestamp ?? Date.now(),
    });
  } catch (error) {
    return json({
      live: false,
      source: "UPSTOX",
      reason:
        error?.message ||
        "Unable to retrieve live quote.",
    });
  }
}

// ----------------------------------------------------
// INTRADAY HISTORY
// ----------------------------------------------------

async function intradayHistory(url, token) {
  const symbol =
    (url.searchParams.get("symbol") || "NIFTY")
      .toUpperCase();

  const timeframe =
    url.searchParams.get("timeframe") || "1m";

  const instrumentKey =
    SYMBOLS[symbol];

  const interval =
    TIMEFRAMES[timeframe];

  if (!instrumentKey) {
    return json({
      live: false,
      source: "UPSTOX",
      reason: "Unsupported instrument.",
      candles: [],
    });
  }

  if (!interval) {
    return json({
      live: false,
      source: "UPSTOX",
      reason: "Unsupported timeframe.",
      candles: [],
    });
  }

  const endpoint =
    "https://api.upstox.com/v3/historical-candle/intraday/" +
    encodeURIComponent(instrumentKey) +
    "/minutes/" +
    interval;

  try {
    const body =
      await upstoxFetch(endpoint, token);

    const rows =
      body?.data?.candles;

    if (!Array.isArray(rows)) {
      return json({
        live: false,
        source: "UPSTOX",
        reason:
          "Upstox did not return candle data.",
        candles: [],
      });
    }

    let candles =
      rows
        .map(normalizeCandle)
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

    candles = unique;

    if (!candles.length) {
      return json({
        live: false,
        source: "UPSTOX",
        symbol,
        timeframe,
        sessionStart: "09:15",
        timezone: IST,
        reason:
          "No candles available for today from 09:15 IST.",
        candles: [],
      });
    }

    return json({
      live: true,
      source: "UPSTOX",
      symbol,
      timeframe,
      instrumentKey,
      sessionStart: "09:15",
      timezone: IST,
      count: candles.length,
      firstCandleTime:
        candles[0].time,
      lastCandleTime:
        candles[candles.length - 1].time,
      candles,
    });
  } catch (error) {
    return json({
      live: false,
      source: "UPSTOX",
      reason:
        error?.message ||
        "Unable to load intraday candles.",
      candles: [],
    });
  }
}

// ----------------------------------------------------
// NIFTY FUTURES CONTRACT DISCOVERY
// ----------------------------------------------------

function expiryMs(value) {
  if (value === null || value === undefined) {
    return NaN;
  }

  if (typeof value === "number") {
    return value < 100000000000
      ? value * 1000
      : value;
  }

  const text = String(value).trim();

  if (/^\d+$/.test(text)) {
    const number = Number(text);

    return number < 100000000000
      ? number * 1000
      : number;
  }

  const parsed =
    new Date(
      `${text.substring(0, 10)}T23:59:59+05:30`
    ).getTime();

  return parsed;
}

function findNearestNiftyFuture(instruments) {
  const now = Date.now();

  return instruments
    .filter((item) => {
      const type =
        String(
          item?.instrument_type || ""
        ).toUpperCase();

      const segment =
        String(
          item?.segment || ""
        ).toUpperCase();

      const symbol =
        String(
          item?.trading_symbol ||
          item?.tradingsymbol ||
          ""
        ).toUpperCase();

      const name =
        String(
          item?.name || ""
        ).toUpperCase();

      const underlying =
        String(
          item?.underlying_symbol ||
          item?.asset_symbol ||
          ""
        ).toUpperCase();

      const expiry =
        expiryMs(item?.expiry);

      const nifty =
        underlying === "NIFTY" ||
        name === "NIFTY" ||
        symbol.startsWith("NIFTY");

      const bankNifty =
        underlying === "BANKNIFTY" ||
        name === "BANKNIFTY" ||
        symbol.startsWith("BANKNIFTY");

      return (
        type === "FUT" &&
        segment === "NSE_FO" &&
        nifty &&
        !bankNifty &&
        Number.isFinite(expiry) &&
        expiry >= now &&
        item?.instrument_key
      );
    })
    .sort(
      (a, b) =>
        expiryMs(a.expiry) -
        expiryMs(b.expiry)
    )[0] || null;
}

async function findNearestNiftyFutureViaSearch(token) {
  const endpoint =
    "https://api.upstox.com/v2/instruments/search" +
    "?query=NIFTY" +
    "&exchanges=NSE" +
    "&segments=FUT" +
    "&page_number=1" +
    "&records=30";

  const body =
    await upstoxFetch(
      endpoint,
      token
    );

  const rows =
    Array.isArray(body?.data)
      ? body.data
      : [];

  const now =
    Date.now();

  const candidates =
    rows
      .filter((item) => {
        const type =
          String(
            item?.instrument_type || ""
          ).toUpperCase();

        const segment =
          String(
            item?.segment || ""
          ).toUpperCase();

        const underlying =
          String(
            item?.underlying_symbol || ""
          ).toUpperCase();

        const symbol =
          String(
            item?.trading_symbol || ""
          ).toUpperCase();

        const expiry =
          expiryMs(
            item?.expiry
          );

        return (
          type === "FUT" &&
          segment === "NSE_FO" &&
          (
            underlying === "NIFTY" ||
            symbol.startsWith("NIFTY ")
          ) &&
          !symbol.startsWith("BANKNIFTY") &&
          Number.isFinite(expiry) &&
          expiry >= now &&
          item?.instrument_key
        );
      })
      .sort(
        (a, b) =>
          expiryMs(a.expiry) -
          expiryMs(b.expiry)
      );

  if (!candidates.length) {
    throw new Error(
      "No active NIFTY futures contract found from Upstox instrument search."
    );
  }

  return candidates[0];
}

// ----------------------------------------------------
// FUTURES VWAP
// ----------------------------------------------------

function calculateVWAP(candles) {
  let priceVolume = 0;
  let totalVolume = 0;

  for (const candle of candles) {
    const volume =
      Number(candle.volume);

    if (
      !Number.isFinite(volume) ||
      volume <= 0
    ) {
      continue;
    }

    const typicalPrice =
      (
        candle.high +
        candle.low +
        candle.close
      ) / 3;

    priceVolume +=
      typicalPrice * volume;

    totalVolume += volume;
  }

  if (totalVolume <= 0) {
    return null;
  }

  return {
    value:
      priceVolume / totalVolume,
    volume: totalVolume,
  };
}

async function futuresVWAP(url, token) {
  try {
    const requested =
      Number(
        url.searchParams.get("interval") || 1
      );

    const allowed =
      [1, 3, 5, 15];

    const interval =
      allowed.includes(requested)
        ? requested
        : 1;

    const contract =
      await findNearestNiftyFutureViaSearch(
        token
      );

    if (!contract) {
      return json({
        live: false,
        source: "UPSTOX",
        type: "FUTURES_VWAP",
        reason:
          "No active NIFTY futures contract found.",
      });
    }

    const instrumentKey =
      contract.instrument_key;

    const endpoint =
      "https://api.upstox.com/v3/historical-candle/intraday/" +
      encodeURIComponent(instrumentKey) +
      "/minutes/" +
      interval;

    const body =
      await upstoxFetch(
        endpoint,
        token
      );

    const rows =
      body?.data?.candles;

    if (!Array.isArray(rows)) {
      return json({
        live: false,
        source: "UPSTOX",
        type: "FUTURES_VWAP",
        reason:
          "Upstox did not return futures candles.",
      });
    }

    const candles =
      rows
        .map(normalizeCandle)
        .filter(Boolean)
        .sort(
          (a, b) =>
            a.time - b.time
        );

    if (!candles.length) {
      return json({
        live: false,
        source: "UPSTOX",
        type: "FUTURES_VWAP",
        reason:
          "No NIFTY futures candles available from 09:15 IST.",
      });
    }

    const result =
      calculateVWAP(candles);

    if (!result) {
      return json({
        live: false,
        source: "UPSTOX",
        type: "FUTURES_VWAP",
        reason:
          "Genuine futures volume is unavailable; VWAP was not fabricated.",
      });
    }

    const latest =
      candles[candles.length - 1];

    const vwap =
      Number(
        result.value.toFixed(2)
      );

    const futuresPrice =
      latest.close;

    const relation =
      futuresPrice > vwap
        ? "ABOVE"
        : futuresPrice < vwap
          ? "BELOW"
          : "AT";

    return json({
      live: true,
      source: "UPSTOX",
      type: "FUTURES_VWAP",
      label: "Futures VWAP",
      underlying: "NIFTY",

      contract:
        contract.trading_symbol ||
        contract.tradingsymbol ||
        contract.name,

      expiry:
        contract.expiry,

      instrumentKey,

      date:
        todayIST(),

      timezone:
        IST,

      sessionStart:
        "09:15",

      interval:
        `${interval}m`,

      candleCount:
        candles.length,

      futuresPrice,

      vwap,

      relation,

      cumulativeVolume:
        result.volume,

      firstCandleTime:
        candles[0].time,

      lastCandleTime:
        latest.time,
    });
  } catch (error) {
    console.error(
      "Futures VWAP error",
      error
    );

    return json({
      live: false,
      source: "UPSTOX",
      type: "FUTURES_VWAP",
      reason:
        error?.message ||
        "Unable to calculate Futures VWAP.",
    });
  }
}

// ----------------------------------------------------
// WORKER ROUTER
// ----------------------------------------------------

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    const token =
      env.UPSTOX_ANALYTICS_TOKEN ||
      env.UPSTOX_ACCESS_TOKEN ||
      env.UPSTOX_TOKEN;

    if (
      url.pathname === "/api/health"
    ) {
      return json({
        live: Boolean(token),
        source: "UPSTOX",
        tokenConfigured: Boolean(token),
        service: "Stride Trading Desk",
        timestamp: new Date().toISOString(),
      });
    }

    if (!token) {
      return json({
        live: false,
        source: "UPSTOX",
        reason:
          "Upstox access token is not configured. Add the Cloudflare secret UPSTOX_ANALYTICS_TOKEN.",
      }, 503);
    }

    if (
      url.pathname === "/api/live-quote"
    ) {
      return liveQuote(
        url,
        token
      );
    }

    if (
      url.pathname === "/api/upstox-history"
    ) {
      return intradayHistory(
        url,
        token
      );
    }

    if (
      url.pathname === "/api/nifty-futures-vwap"
    ) {
      return futuresVWAP(
        url,
        token
      );
    }

    /*
     * Serve the existing Pro Scalper static site.
     * ASSETS is supplied by the Wrangler assets binding.
     */
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "Pro Scalper API",
      {
        status: 200,
        headers: {
          "content-type":
            "text/plain; charset=utf-8",
        },
      }
    );
  },
};
