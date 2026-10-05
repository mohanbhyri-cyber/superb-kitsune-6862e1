export function regularNseHours(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const minute = Number(p.hour) * 60 + Number(p.minute);
  return !['Sat', 'Sun'].includes(p.weekday) && minute >= 555 && minute < 930;
}

export function summarizeOptions(rows, expiry, fetchedAt = Date.now()) {
  const unavailable = { available: false, live: false, reason: 'Incomplete option chain' };
  if (!Array.isArray(rows) || rows.length < 2) return unavailable;
  let calls = 0, puts = 0, callMax = -1, putMax = -1;
  let callWall = null, putWall = null;
  const strikes = new Set();
  for (const row of rows) {
    const strike = row?.strike_price;
    const call = row?.call_options?.market_data?.oi;
    const put = row?.put_options?.market_data?.oi;
    if (row?.expiry !== expiry || row?.underlying_key !== 'NSE_INDEX|Nifty 50' ||
        !Number.isFinite(strike) || strike <= 0 || strikes.has(strike) ||
        !Number.isFinite(call) || call < 0 || !Number.isFinite(put) || put < 0) return unavailable;
    strikes.add(strike);
    calls += call;
    puts += put;
    if (call > callMax) { callMax = call; callWall = strike; }
    else if (call === callMax) callWall = null;
    if (put > putMax) { putMax = put; putWall = strike; }
    else if (put === putMax) putWall = null;
  }
  if (calls <= 0 || puts <= 0 || !Number.isFinite(calls + puts)) return unavailable;
  const pcr = puts / calls;
  const bias =
    pcr >= 1.15 && putWall !== null && callWall !== null && Number(putWall) <= Number(callWall)
      ? 'BULLISH'
      : pcr <= 0.85 && putWall !== null && callWall !== null && Number(callWall) >= Number(putWall)
        ? 'BEARISH'
        : 'NEUTRAL';
  return { available: true, live: false, expiry, fetchedAt, pcr,
    callWall, putWall, callOI: calls, putOI: puts, strikeCount: strikes.size, bias };
}
