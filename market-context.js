// Closed-candle market context. Levels are descriptive only; they never create
// a BUY/SELL signal and return null when the source candles are insufficient.
const finite = value => Number.isFinite(Number(value));
const istParts = time => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(Number(time) * 1000));
  const get = type => parts.find(part => part.type === type)?.value;
  return { year: get('year'), month: get('month'), day: get('day') };
};
const dayKey = time => { const p = istParts(time); return `${p.year}-${p.month}-${p.day}`; };
const weekKey = time => {
  const date = new Date(Number(time) * 1000);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const monday = new Date(utc); monday.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
};
const aggregate = rows => rows.length ? ({
  high: Math.max(...rows.map(row => Number(row.high))),
  low: Math.min(...rows.map(row => Number(row.low)))
}) : null;

export function analyseMarketContext(candles, calc = {}, seconds = 60) {
  if (!Array.isArray(candles) || candles.length < 3) return { ready: false };
  const closed = candles.slice(0, -1).filter(row => row && finite(row.time) && finite(row.high) && finite(row.low) && finite(row.close));
  if (closed.length < 2) return { ready: false };
  const latest = closed.at(-1);
  const latestDay = dayKey(latest.time);
  const latestWeek = weekKey(latest.time);
  const today = closed.filter(row => dayKey(row.time) === latestDay);
  const days = [...new Set(closed.map(row => dayKey(row.time)))];
  const previousDay = days.length > 1 ? aggregate(closed.filter(row => dayKey(row.time) === days.at(-2))) : null;
  const weeks = [...new Set(closed.map(row => weekKey(row.time)))];
  const previousWeek = weeks.length > 1 ? aggregate(closed.filter(row => weekKey(row.time) === weeks.at(-2))) : null;
  const i = closed.length - 1;
  const ema21 = calc.e21?.[i];
  const ema50 = calc.e50?.[i];
  const atr = calc.atr?.[i];
  const tolerance = finite(atr) ? Number(atr) * 0.25 : null;
  const close = Number(latest.close);
  const bullish = finite(ema21) && finite(ema50) && Number(ema21) > Number(ema50);
  const bearish = finite(ema21) && finite(ema50) && Number(ema21) < Number(ema50);
  const touched21 = finite(ema21) && (Number(latest.low) <= Number(ema21) + (tolerance || 0)) && (Number(latest.high) >= Number(ema21) - (tolerance || 0));
  const pullback = touched21 && ((bullish && close > Number(ema21)) || (bearish && close < Number(ema21)))
    ? (bullish ? 'BULLISH EMA21 PULLBACK' : 'BEARISH EMA21 PULLBACK') : 'NO CONFIRMED EMA21 PULLBACK';
  return {
    ready: true, session: aggregate(today), previousDay, previousWeek,
    emaPullback: { state: pullback, ema21: finite(ema21) ? Number(ema21) : null, tolerance },
    asOf: latest.time, seconds, week: latestWeek
  };
}
