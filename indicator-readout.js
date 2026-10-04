import { indicators } from './market.js';

export function indicatorReadout(candles, technical) {
  const waiting = { bands: 'WAIT', stochastic: 'WAIT', cloud: 'WAIT' };
  if (!Array.isArray(candles) || candles.length < 220) return waiting;
  if (candles.some(c => ['high', 'low', 'close'].some(k => c?.[k] == null || !Number.isFinite(Number(c[k]))))) return waiting;
  const number = value => Number.isFinite(value) ? value.toFixed(2) : 'Unavailable';
  const bands = indicators(candles).bb.at(-1);
  const midpoint = (end, period) => {
    const window = candles.slice(end - period + 1, end + 1);
    return (Math.max(...window.map(c => Number(c.high))) + Math.min(...window.map(c => Number(c.low)))) / 2;
  };
  const end = candles.length - 1;
  const tenkan = midpoint(end, 9), kijun = midpoint(end, 26);
  // The cloud at the current candle was calculated 26 candles earlier.
  const spanA = (midpoint(end - 26, 9) + midpoint(end - 26, 26)) / 2;
  const spanB = midpoint(end - 26, 52);
  const close = Number(candles[end].close);
  const bias = close > Math.max(spanA, spanB) && tenkan > kijun ? 'BULLISH'
    : close < Math.min(spanA, spanB) && tenkan < kijun ? 'BEARISH' : 'WAIT';
  const stochastic = technical?.stochasticRsi;
  return {
    bands: bands ? `Upper ${number(bands.upper)} | Middle ${number(bands.mid)} | Lower ${number(bands.lower)}` : 'WAIT',
    stochastic: stochastic?.value != null && Number.isFinite(stochastic.value)
      ? `${number(stochastic.value * 100)} / 100 | ${stochastic.signal}` : 'WAIT',
    cloud: `${bias} | Tenkan ${number(tenkan)} | Kijun ${number(kijun)} | Span A ${number(spanA)} | Span B ${number(spanB)}`
  };
}

export function renderIndicatorReadout(candles, technical) {
  const values = indicatorReadout(candles, technical);
  for (const [name, value] of Object.entries(values)) {
    const element = document.querySelector('#indicator-' + name);
    if (element) element.textContent = value;
  }
}
