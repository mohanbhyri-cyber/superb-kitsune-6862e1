const finite = value => typeof value === 'number' && Number.isFinite(value);
const stamp = time => new Date(time * 1000).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
}) + ' IST';

// Display provenance only. This does not replace candles, close a forming bar,
// change indicator inputs, approve a trade, or turn receipt time into feed time.
export function quoteDisplay({ candles = [], quote, quoteTime, seconds, now = Date.now() / 1000,
  replay = false, sessionOpen = false }) {
  const visible = Array.isArray(candles) ? candles : [];
  const last = replay ? visible.at(-1) : [...visible].reverse().find(c =>
    finite(c?.time) && finite(c?.close) && finite(seconds) && seconds > 0 && c.time + seconds <= now);
  if (replay) return { price: finite(last?.close) ? last.close : null, kind: 'historical',
    description: last ? 'HISTORICAL candle close · ' + stamp(last.time) + ' · NOT LIVE' : 'HISTORICAL · data unavailable · NOT LIVE' };
  const currentQuote = sessionOpen && finite(quote) && finite(quoteTime) &&
    quoteTime > 0 && quoteTime <= now + 5 && now - quoteTime <= 30 &&
    (!last || quoteTime >= last.time + seconds);
  if (currentQuote) return { price: quote, kind: 'quote', description: 'Provider quote · ' + stamp(quoteTime) };
  if (last) return { price: last.close, kind: 'candle',
    description: 'Last available candle close · ' + stamp(last.time + seconds) + ' · NOT LIVE' };
  return { price: finite(quote) ? quote : null, kind: 'unverified',
    description: finite(quote) ? 'Quote time unverified · NOT LIVE' : 'Price unavailable' };
}
