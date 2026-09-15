const keys = {
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
};

export default async (request) => {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  const instrumentKey = keys[symbol];
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!instrumentKey || !token) {
    return new Response(JSON.stringify({ live: false, reason: 'Live feed is not configured for this instrument.' }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  const response = await fetch(`https://api.upstox.com/v2/market-quote/ltp?instrument_key=${encodeURIComponent(instrumentKey)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!response.ok) return new Response(JSON.stringify({ live: false, reason: `Upstox returned ${response.status}.` }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const body = await response.json();
  const quote = Object.values(body.data ?? {})[0];
  return new Response(JSON.stringify({ live: Number.isFinite(quote?.last_price), price: quote?.last_price ?? null, timestamp: quote?.timestamp ?? Date.now() }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
