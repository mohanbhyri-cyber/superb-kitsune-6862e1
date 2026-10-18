// netlify/functions/live-quote.js
// PRO SCALPER - REAL UPSTOX LIVE QUOTE
// No demo/random fallback.

const keys = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
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

export default async (request) => {
  try {
    const url = new URL(request.url);

    const symbol = (
      url.searchParams.get('symbol') || 'NIFTY'
    ).toUpperCase();

    const instrumentKey = keys[symbol];

    const token =
      process.env.UPSTOX_ANALYTICS_TOKEN;

    if (!instrumentKey) {
      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason: 'Unsupported instrument.',
      });
    }

    if (!token) {
      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason:
          'UPSTOX_ANALYTICS_TOKEN is not configured.',
      });
    }

    const endpoint =
      'https://api.upstox.com/v2/market-quote/ltp' +
      '?instrument_key=' +
      encodeURIComponent(instrumentKey);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const details = await response
        .text()
        .catch(() => '');

      console.error(
        'Upstox live quote error:',
        response.status,
        details
      );

      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason:
          `Upstox returned HTTP ${response.status}.`,
      });
    }

    const body = await response.json();

    const quote =
      Object.values(body?.data ?? {})[0];

    const price =
      Number(quote?.last_price);

    if (!Number.isFinite(price)) {
      return sendJSON({
        live: false,
        source: 'UPSTOX',
        reason:
          'Upstox returned an invalid price.',
      });
    }

    // Only provider-sourced timestamps may establish quote freshness.
    // Upstox timestamps can be seconds, milliseconds or ISO date strings.
    const rawTimestamp = quote?.timestamp ?? quote?.last_trade_time;
    const numericTimestamp = Number(rawTimestamp);
    const parsedTimestamp = rawTimestamp == null ? NaN
      : Number.isFinite(numericTimestamp) && numericTimestamp > 0
        ? (numericTimestamp > 1e11 ? numericTimestamp / 1000 : numericTimestamp)
        : Date.parse(String(rawTimestamp)) / 1000;
    const quoteTime = Math.floor(parsedTimestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(quoteTime) || quoteTime <= 0 || quoteTime > now + 60) {
      return sendJSON({ live: false, source: 'UPSTOX', reason: 'Quote timestamp missing or invalid.' });
    }

    return sendJSON({
      live: true,
      source: 'UPSTOX',
      symbol,
      instrumentKey,
      price,
      time: quoteTime,
      timestamp: quoteTime,
    });

  } catch (error) {
    console.error(
      'live-quote error:',
      error
    );

    return sendJSON({
      live: false,
      source: 'UPSTOX',
      reason:
        error?.message ||
        'Unable to retrieve live quote.',
    });
  }
};
