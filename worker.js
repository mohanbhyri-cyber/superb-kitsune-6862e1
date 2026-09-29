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
const istFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    },
  });
}

function getISTParts(value = Date.now()) {
  const parts = istFormatter.formatToParts(new Date(value));

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

function normalizeRegularSessionCandle(row) {
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

  const p =
    getISTParts(ms);

  const minutes =
    Number(p.hour) * 60 +
    Number(p.minute);

  if (
    minutes < 9 * 60 + 15 ||
    minutes > 15 * 60 + 30
  ) {
    return null;
  }

  const candle = {
    time:
      Math.floor(ms / 1000),
    open:
      Number(open),
    high:
      Number(high),
    low:
      Number(low),
    close:
      Number(close),
    volume:
      Number(volume) || 0,
    openInterest:
      Number(openInterest) || 0,
  };

  if (
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close) ||
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0
  ) {
    return null;
  }

  return candle;
}


function normalizeCandleForISTDate(row, dateText) {
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

  const p = getISTParts(ms);
  const candleDate =
    `${p.year}-${p.month}-${p.day}`;

  if (candleDate !== dateText) {
    return null;
  }

  const minutes =
    Number(p.hour) * 60 +
    Number(p.minute);

  if (minutes < 9 * 60 + 15) {
    return null;
  }

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


function istDateMinusDays(days) {
  const base =
    new Date(
      todayIST() +
      "T12:00:00+05:30"
    );

  const target =
    new Date(
      base.getTime() -
      days * 86400000
    );

  const p =
    getISTParts(
      target.getTime()
    );

  return `${p.year}-${p.month}-${p.day}`;
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
    "https://api.upstox.com/v3/market-quote/quotes" +
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

    const netChange =
      Number(quote?.net_change);

    const previousCloseRaw =
      Number(quote?.prev_close_price);

    const previousClose =
      Number.isFinite(previousCloseRaw)
        ? previousCloseRaw
        : Number.isFinite(netChange)
          ? price - netChange
          : null;

    const changePercent =
      Number.isFinite(netChange) &&
      Number.isFinite(previousClose) &&
      previousClose !== 0
        ? (netChange / previousClose) * 100
        : null;

    return json({
      live: true,
      source: "UPSTOX",
      symbol,
      instrumentKey,
      price,
      netChange:
        Number.isFinite(netChange)
          ? netChange
          : null,
      previousClose:
        Number.isFinite(previousClose)
          ? previousClose
          : null,
      changePercent:
        Number.isFinite(changePercent)
          ? changePercent
          : null,
      sessionOpen:
        Number.isFinite(
          Number(quote?.ohlc?.open)
        )
          ? Number(quote.ohlc.open)
          : null,
      volume:
        Number.isFinite(
          Number(quote?.volume)
        )
          ? Number(quote.volume)
          : 0,
      time:
        Number.isFinite(
          Number(quote?.last_trade_time)
        )
          ? Math.floor(
              Number(
                quote.last_trade_time
              ) / 1000
            )
          : Math.floor(
              Date.now() / 1000
            ),
      timestamp:
        quote?.timestamp ??
        quote?.last_trade_time ??
        Date.now(),
    });
  } catch (error) {
    console.warn(
      "Primary live quote failed, using intraday fallback",
      error?.message || error
    );

    try {
      const fallbackEndpoint =
        "https://api.upstox.com/v3/historical-candle/intraday/" +
        encodeURIComponent(instrumentKey) +
        "/minutes/1";

      const fallbackBody =
        await upstoxFetch(
          fallbackEndpoint,
          token
        );

      const rows =
        Array.isArray(
          fallbackBody?.data?.candles
        )
          ? fallbackBody.data.candles
          : [];

      const candles =
        rows
          .map(normalizeCandle)
          .filter(Boolean)
          .sort(
            (x, y) =>
              x.time - y.time
          );

      const latest =
        candles.at(-1);

      if (latest) {
        return json({
          live: true,
          source:
            "UPSTOX_INTRADAY_FALLBACK",
          symbol,
          instrumentKey,
          price:
            latest.close,
          netChange:
            null,
          previousClose:
            null,
          changePercent:
            null,
          sessionOpen:
            candles[0]?.open ?? null,
          volume:
            latest.volume || 0,
          time:
            latest.time,
          timestamp:
            latest.time * 1000,
          fallback:
            true,
          primaryError:
            error?.message ||
            "Primary quote unavailable.",
        });
      }
    } catch (
      fallbackError
    ) {
      console.warn(
        "Intraday live quote fallback failed",
        fallbackError?.message ||
        fallbackError
      );
    }

    return json({
      live: false,
      source: "UPSTOX",
      reason:
        error?.message ||
        "Unable to retrieve live quote.",
    });
  }
}

async function previousTradingSession(
  instrumentKey,
  interval,
  token
) {
  for (
    let daysBack = 1;
    daysBack <= 7;
    daysBack += 1
  ) {
    const date =
      istDateMinusDays(
        daysBack
      );

    const endpoint =
      "https://api.upstox.com/v3/historical-candle/" +
      encodeURIComponent(instrumentKey) +
      "/minutes/" +
      interval +
      "/" +
      date +
      "/" +
      date;

    try {
      const body =
        await upstoxFetch(
          endpoint,
          token
        );

      const rows =
        body?.data?.candles;

      if (!Array.isArray(rows)) {
        continue;
      }

      const candles =
        rows
          .map(
            row =>
              normalizeCandleForISTDate(
                row,
                date
              )
          )
          .filter(Boolean)
          .sort(
            (a, b) =>
              a.time - b.time
          );

      if (candles.length) {
        return {
          date,
          candles,
        };
      }
    } catch (error) {
      console.warn(
        "Previous-session candle fetch failed",
        date,
        error?.message || error
      );
    }
  }

  return {
    date: null,
    candles: [],
  };
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

  const intradayEndpoint =
    "https://api.upstox.com/v3/historical-candle/intraday/" +
    encodeURIComponent(instrumentKey) +
    "/minutes/" +
    interval;

  const today =
    todayIST();

  const historicalTodayEndpoint =
    "https://api.upstox.com/v3/historical-candle/" +
    encodeURIComponent(instrumentKey) +
    "/minutes/" +
    interval +
    "/" +
    today +
    "/" +
    today;

  try {
    let rows = [];

    try {
      const intradayBody =
        await upstoxFetch(
          intradayEndpoint,
          token
        );

      if (
        Array.isArray(
          intradayBody?.data?.candles
        )
      ) {
        rows =
          intradayBody.data.candles;
      }
    } catch (error) {
      console.warn(
        "Primary intraday candle fetch failed",
        error?.message || error
      );
    }

    if (!rows.length) {
      try {
        const historicalTodayBody =
          await upstoxFetch(
            historicalTodayEndpoint,
            token
          );

        if (
          Array.isArray(
            historicalTodayBody?.data?.candles
          )
        ) {
          rows =
            historicalTodayBody.data.candles;
        }
      } catch (error) {
        console.warn(
          "Today historical-candle fallback failed",
          error?.message || error
        );
      }
    }

    if (!rows.length) {
      const previous =
        await previousTradingSession(
          instrumentKey,
          interval,
          token
        );

      if (
        previous.candles.length
      ) {
        return json({
          live: true,
          source: "UPSTOX",
          symbol,
          timeframe,
          instrumentKey,
          sessionStart: "09:15",
          timezone: IST,
          count:
            previous.candles.length,
          currentSessionDate:
            today,
          currentSessionCount:
            0,
          sessionDate:
            previous.date,
          marketOpen:
            false,
          historyMode:
            "previous-session-preopen-fallback",
          firstCandleTime:
            previous.candles[0].time,
          lastCandleTime:
            previous.candles[
              previous.candles.length - 1
            ].time,
          candles:
            previous.candles,
        });
      }

      return json({
        live: false,
        source: "UPSTOX",
        symbol,
        timeframe,
        reason:
          "No current or previous-session candles returned by Upstox.",
        candles: [],
      });
    }

    const todayCandles =
      rows
        .map(normalizeCandle)
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);

    let candles =
      todayCandles.slice();

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
          "No current or previous-session candles available from 09:15 IST.",
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
      currentSessionDate:
        todayIST(),
      currentSessionCount:
        todayCandles.length,
      historyMode:
        "intraday-with-historical-fallback",
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

async function previousSessionHistory(url, token) {
  const symbol =
    (url.searchParams.get("symbol") || "NIFTY")
      .toUpperCase();

  const timeframe =
    url.searchParams.get("timeframe") || "5m";

  const instrumentKey =
    SYMBOLS[symbol];

  const interval =
    TIMEFRAMES[timeframe];

  if (!instrumentKey || !interval) {
    return json({
      live: false,
      source: "UPSTOX",
      reason: "Unsupported instrument or timeframe.",
      candles: [],
    });
  }

  const previous =
    await previousTradingSession(
      instrumentKey,
      interval,
      token
    );

  return json({
    live: previous.candles.length > 0,
    source: "UPSTOX",
    symbol,
    timeframe,
    sessionDate: previous.date,
    count: previous.candles.length,
    candles: previous.candles,
  });
}


async function mtfHistory(url, token) {
  const symbol =
    (url.searchParams.get("symbol") || "NIFTY")
      .toUpperCase();

  const timeframe =
    url.searchParams.get("timeframe") || "5m";

  const instrumentKey =
    SYMBOLS[symbol];

  const config = {
    "5m": {
      unit: "minutes",
      interval: 5,
      lookbackDays: 7,
    },
    "15m": {
      unit: "minutes",
      interval: 15,
      lookbackDays: 10,
    },
    "1h": {
      unit: "hours",
      interval: 1,
      lookbackDays: 45,
    },
  }[timeframe];

  if (!instrumentKey || !config) {
    return json({
      live: false,
      source: "UPSTOX",
      symbol,
      timeframe,
      reason:
        "Unsupported MTF instrument or timeframe.",
      candles: [],
    });
  }

  const today =
    todayIST();

  const fromDate =
    istDateMinusDays(
      config.lookbackDays
    );

  const historicalEndpoint =
    "https://api.upstox.com/v3/historical-candle/" +
    encodeURIComponent(instrumentKey) +
    "/" +
    config.unit +
    "/" +
    config.interval +
    "/" +
    today +
    "/" +
    fromDate;

  const intradayEndpoint =
    "https://api.upstox.com/v3/historical-candle/intraday/" +
    encodeURIComponent(instrumentKey) +
    "/" +
    config.unit +
    "/" +
    config.interval;

  try {
    const results =
      await Promise.allSettled([
        upstoxFetch(
          historicalEndpoint,
          token
        ),
        upstoxFetch(
          intradayEndpoint,
          token
        ),
      ]);

    const rows = [];

    for (const result of results) {
      if (
        result.status === "fulfilled" &&
        Array.isArray(
          result.value?.data?.candles
        )
      ) {
        rows.push(
          ...result.value.data.candles
        );
      }
    }

    const candles =
      rows
        .map(
          normalizeRegularSessionCandle
        )
        .filter(Boolean)
        .sort(
          (x, y) =>
            x.time - y.time
        );

    const unique = [];

    for (const candle of candles) {
      const last =
        unique[unique.length - 1];

      if (
        last &&
        last.time === candle.time
      ) {
        unique[
          unique.length - 1
        ] = candle;
      } else {
        unique.push(candle);
      }
    }

    const trimmed =
      unique.slice(-500);

    return json({
      live:
        trimmed.length > 0,
      source: "UPSTOX",
      symbol,
      timeframe,
      unit:
        config.unit,
      interval:
        config.interval,
      fromDate,
      toDate:
        today,
      count:
        trimmed.length,
      candles:
        trimmed,
    });
  } catch (error) {
    return json({
      live: false,
      source: "UPSTOX",
      symbol,
      timeframe,
      reason:
        error?.message ||
        "Unable to load multi-timeframe history.",
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

async function externalNiftySources() {
  const sources = [];
  const errors = [];

  const yahooTask = (async () => {
    const endpoint =
      "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI" +
      "?interval=5m&range=1d&includePrePost=false";

    const response =
      await fetch(endpoint, {
        headers: {
          "User-Agent":
            "Mozilla/5.0",
          Accept:
            "application/json",
        },
      });

    if (!response.ok) {
      throw new Error(
        "Yahoo Finance HTTP " +
        response.status
      );
    }

    const body =
      await response.json();

    const result =
      body?.chart?.result?.[0];

    const meta =
      result?.meta || {};

    const timestamps =
      Array.isArray(
        result?.timestamp
      )
        ? result.timestamp
        : [];

    const closes =
      Array.isArray(
        result
          ?.indicators
          ?.quote
          ?.[0]
          ?.close
      )
        ? result.indicators.quote[0].close
        : [];

    const validCloses =
      closes
        .map(Number)
        .filter(
          Number.isFinite
        );

    const price =
      Number(
        meta.regularMarketPrice
      );

    const previousClose =
      Number(
        meta.chartPreviousClose ??
        meta.previousClose
      );

    const changePercent =
      Number.isFinite(price) &&
      Number.isFinite(previousClose) &&
      previousClose !== 0
        ? (
            (
              price -
              previousClose
            ) /
            previousClose
          ) * 100
        : null;

    let momentum =
      0;

    if (
      validCloses.length >= 4
    ) {
      const latest =
        validCloses.at(-1);

      const prior =
        validCloses.at(-4);

      if (
        Number.isFinite(latest) &&
        Number.isFinite(prior) &&
        prior !== 0
      ) {
        momentum =
          (
            (
              latest -
              prior
            ) /
            prior
          ) * 100;
      }
    }

    return {
      name:
        "Yahoo Finance",
      live:
        Number.isFinite(price),
      price:
        Number.isFinite(price)
          ? price
          : null,
      previousClose:
        Number.isFinite(previousClose)
          ? previousClose
          : null,
      changePercent:
        Number.isFinite(changePercent)
          ? changePercent
          : null,
      momentum:
        Number.isFinite(momentum)
          ? momentum
          : 0,
      timestamp:
        Number(
          meta.regularMarketTime
        ) ||
        timestamps.at(-1) ||
        null,
    };
  })();

  const tradingViewTask =
    (async () => {
      const response =
        await fetch(
          "https://scanner.tradingview.com/india/scan",
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
              Accept:
                "application/json",
              "User-Agent":
                "Mozilla/5.0",
            },
            body:
              JSON.stringify({
                symbols: {
                  tickers: [
                    "NSE:NIFTY"
                  ],
                  query: {
                    types: []
                  }
                },
                columns: [
                  "close",
                  "change",
                  "Recommend.All",
                  "RSI",
                  "MACD.macd",
                  "MACD.signal",
                  "EMA20",
                  "EMA50"
                ]
              }),
          }
        );

      if (!response.ok) {
        throw new Error(
          "TradingView HTTP " +
          response.status
        );
      }

      const body =
        await response.json();

      const row =
        body?.data?.[0]?.d;

      if (
        !Array.isArray(row)
      ) {
        throw new Error(
          "TradingView returned no NIFTY row"
        );
      }

      const [
        close,
        change,
        recommendAll,
        rsi,
        macd,
        macdSignal,
        ema20,
        ema50
      ] = row.map(
        value =>
          value == null
            ? null
            : Number(value)
      );

      return {
        name:
          "TradingView",
        live:
          Number.isFinite(close),
        price:
          Number.isFinite(close)
            ? close
            : null,
        changePercent:
          Number.isFinite(change)
            ? change
            : null,
        recommendAll:
          Number.isFinite(
            recommendAll
          )
            ? recommendAll
            : null,
        rsi:
          Number.isFinite(rsi)
            ? rsi
            : null,
        macd:
          Number.isFinite(macd)
            ? macd
            : null,
        macdSignal:
          Number.isFinite(
            macdSignal
          )
            ? macdSignal
            : null,
        ema20:
          Number.isFinite(ema20)
            ? ema20
            : null,
        ema50:
          Number.isFinite(ema50)
            ? ema50
            : null,
      };
    })();

  const results =
    await Promise.allSettled([
      yahooTask,
      tradingViewTask
    ]);

  for (
    const result of results
  ) {
    if (
      result.status ===
      "fulfilled"
    ) {
      sources.push(
        result.value
      );
    } else {
      errors.push(
        result.reason
          ?.message ||
        String(
          result.reason
        )
      );
    }
  }

  return json({
    live:
      sources.some(
        source =>
          source.live
      ),
    symbol:
      "NIFTY 50",
    sourceCount:
      sources.length,
    sources,
    errors,
    timestamp:
      new Date()
        .toISOString(),
  });
}


async function globalMarketWatch() {
  const symbols = [
    {
      key: "sp500_futures",
      name: "S&P 500 Futures",
      symbol: "ES=F",
      role: "risk"
    },
    {
      key: "nasdaq_futures",
      name: "Nasdaq Futures",
      symbol: "NQ=F",
      role: "risk"
    },
    {
      key: "dow_futures",
      name: "Dow Futures",
      symbol: "YM=F",
      role: "risk"
    },
    {
      key: "vix",
      name: "VIX",
      symbol: "^VIX",
      role: "inverse"
    },
    {
      key: "usd_inr",
      name: "USD/INR",
      symbol: "INR=X",
      role: "inverse_small"
    },
    {
      key: "nikkei",
      name: "Nikkei 225",
      symbol: "^N225",
      role: "risk"
    },
    {
      key: "hang_seng",
      name: "Hang Seng",
      symbol: "^HSI",
      role: "risk"
    }
  ];

  const fetchOne =
    async item => {
      const endpoint =
        "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(
          item.symbol
        ) +
        "?interval=5m&range=1d&includePrePost=true";

      const response =
        await fetch(
          endpoint,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0",
              Accept:
                "application/json",
            },
          }
        );

      if (!response.ok) {
        throw new Error(
          item.name +
          " HTTP " +
          response.status
        );
      }

      const body =
        await response.json();

      const result =
        body?.chart?.result?.[0];

      if (!result) {
        throw new Error(
          item.name +
          " returned no data"
        );
      }

      const meta =
        result.meta || {};

      const closes =
        Array.isArray(
          result
            ?.indicators
            ?.quote
            ?.[0]
            ?.close
        )
          ? result.indicators.quote[0].close
          : [];

      const valid =
        closes
          .map(Number)
          .filter(
            Number.isFinite
          );

      const price =
        Number(
          meta.regularMarketPrice
        );

      const previousClose =
        Number(
          meta.chartPreviousClose ??
          meta.previousClose
        );

      const changePercent =
        Number.isFinite(price) &&
        Number.isFinite(previousClose) &&
        previousClose !== 0
          ? (
              (
                price -
                previousClose
              ) /
              previousClose
            ) * 100
          : null;

      let momentum = null;

      if (
        valid.length >= 4
      ) {
        const latest =
          valid.at(-1);

        const prior =
          valid.at(-4);

        if (
          Number.isFinite(latest) &&
          Number.isFinite(prior) &&
          prior !== 0
        ) {
          momentum =
            (
              (
                latest -
                prior
              ) /
              prior
            ) * 100;
        }
      }

      return {
        key:
          item.key,
        name:
          item.name,
        symbol:
          item.symbol,
        role:
          item.role,
        price:
          Number.isFinite(price)
            ? price
            : null,
        previousClose:
          Number.isFinite(
            previousClose
          )
            ? previousClose
            : null,
        changePercent:
          Number.isFinite(
            changePercent
          )
            ? changePercent
            : null,
        momentum:
          Number.isFinite(
            momentum
          )
            ? momentum
            : null,
        marketState:
          meta.marketState ||
          null,
        timestamp:
          Number(
            meta.regularMarketTime
          ) ||
          result.timestamp?.at(-1) ||
          null,
      };
    };

  const settled =
    await Promise.allSettled(
      symbols.map(
        fetchOne
      )
    );

  const items = [];
  const errors = [];

  for (
    const result of settled
  ) {
    if (
      result.status ===
      "fulfilled"
    ) {
      items.push(
        result.value
      );
    } else {
      errors.push(
        result.reason
          ?.message ||
        String(
          result.reason
        )
      );
    }
  }

  return json({
    live:
      items.length > 0,
    type:
      "GLOBAL_MARKET_WATCH",
    label:
      "24/7 Global Watch",
    source:
      "YAHOO_FINANCE",
    count:
      items.length,
    items,
    errors,
    timestamp:
      new Date()
        .toISOString(),
  });
}


async function niftyDailyHistory(url, token) {
  const instrumentKey =
    SYMBOLS.NIFTY;

  const days =
    Math.max(
      45,
      Math.min(
        180,
        Number(
          url.searchParams.get("days")
        ) || 90
      )
    );

  const toDate =
    todayIST();

  const fromDate =
    istDateMinusDays(
      days
    );

  const endpoint =
    "https://api.upstox.com/v3/historical-candle/" +
    encodeURIComponent(instrumentKey) +
    "/days/1/" +
    toDate +
    "/" +
    fromDate;

  try {
    const body =
      await upstoxFetch(
        endpoint,
        token
      );

    const rows =
      Array.isArray(
        body?.data?.candles
      )
        ? body.data.candles
        : [];

    const candles =
      rows
        .map(
          row => {
            if (
              !Array.isArray(row) ||
              row.length < 6
            ) {
              return null;
            }

            const [
              timestamp,
              open,
              high,
              low,
              close,
              volume
            ] = row;

            const ms =
              new Date(
                timestamp
              ).getTime();

            if (
              !Number.isFinite(ms)
            ) {
              return null;
            }

            const candle = {
              time:
                Math.floor(
                  ms / 1000
                ),
              open:
                Number(open),
              high:
                Number(high),
              low:
                Number(low),
              close:
                Number(close),
              volume:
                Number(volume) || 0
            };

            return [
              candle.open,
              candle.high,
              candle.low,
              candle.close
            ].every(
              Number.isFinite
            )
              ? candle
              : null;
          }
        )
        .filter(Boolean)
        .sort(
          (x, y) =>
            x.time - y.time
        );

    return json({
      live:
        candles.length > 0,
      source:
        "UPSTOX",
      symbol:
        "NIFTY 50",
      timeframe:
        "1d",
      fromDate,
      toDate,
      count:
        candles.length,
      candles
    });

  } catch (error) {
    return json({
      live: false,
      source:
        "UPSTOX",
      symbol:
        "NIFTY 50",
      timeframe:
        "1d",
      reason:
        error?.message ||
        "Unable to load daily NIFTY history.",
      candles: []
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

    if (
      request.method === "OPTIONS" &&
      url.pathname.startsWith("/api/")
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
          "access-control-max-age": "86400",
        },
      });
    }

    const token =
      env.UPSTOX_EXTENDED_TOKEN ||
      env.UPSTOX_ANALYTICS_TOKEN ||
      env.UPSTOX_ACCESS_TOKEN ||
      env.UPSTOX_TOKEN;

    if (
      url.pathname === "/api/external-nifty"
    ) {
      return externalNiftySources();
    }

    if (
      url.pathname === "/api/global-watch"
    ) {
      return globalMarketWatch();
    }

    if (
      url.pathname === "/api/health"
    ) {
      if (!token) {
        return json({
          live: false,
          source: "UPSTOX",
          tokenConfigured: false,
          tokenValid: false,
          service: "Stride Trading Desk",
          reason:
            "Upstox token is not configured.",
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const endpoint =
          "https://api.upstox.com/v3/market-quote/quotes" +
          "?instrument_key=" +
          encodeURIComponent(SYMBOLS.NIFTY);

        const body =
          await upstoxFetch(
            endpoint,
            token
          );

        const quote =
          Object.values(
            body?.data ?? {}
          )[0];

        const price =
          Number(
            quote?.last_price
          );

        return json({
          live:
            Number.isFinite(price),
          source: "UPSTOX",
          tokenConfigured: true,
          tokenValid:
            Number.isFinite(price),
          price:
            Number.isFinite(price)
              ? price
              : null,
          service: "Stride Trading Desk",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        return json({
          live: false,
          source: "UPSTOX",
          tokenConfigured: true,
          tokenValid: false,
          service: "Stride Trading Desk",
          reason:
            "Upstox token expired or is invalid. Generate today's token or configure UPSTOX_EXTENDED_TOKEN.",
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (!token) {
      return json({
        live: false,
        source: "UPSTOX",
        reason:
          "Upstox token is not configured. Add UPSTOX_EXTENDED_TOKEN or today's UPSTOX_ANALYTICS_TOKEN in Cloudflare secrets.",
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
      url.pathname === "/api/upstox-previous-history"
    ) {
      return previousSessionHistory(
        url,
        token
      );
    }

    if (
      url.pathname === "/api/upstox-mtf-history"
    ) {
      return mtfHistory(
        url,
        token
      );
    }

    if (
      url.pathname === "/api/nifty-daily-history"
    ) {
      return niftyDailyHistory(
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
      const response =
        await env.ASSETS.fetch(request);

      const headers =
        new Headers(
          response.headers
        );

      if (
        url.pathname === "/" ||
        url.pathname.endsWith(".html") ||
        url.pathname.endsWith(".js") ||
        url.pathname.endsWith(".css")
      ) {
        headers.set(
          "cache-control",
          "no-store, no-cache, must-revalidate, max-age=0"
        );

        headers.set(
          "pragma",
          "no-cache"
        );

        headers.set(
          "expires",
          "0"
        );
      }

      return new Response(
        response.body,
        {
          status:
            response.status,
          statusText:
            response.statusText,
          headers,
        }
      );
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

