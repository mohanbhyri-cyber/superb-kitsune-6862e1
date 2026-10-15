import { premiumSettings } from './premium-indicator-settings.js';
import { trendIndicators } from './trend-indicators.js';
import { momentumSignals } from './momentum.js';

// Adapter: no live-data fetching, trading execution or fabricated candles.
// Caller must pass completed candles and independently verified freshness.
export function premiumIndicatorSnapshot({ timeframe = '5m', candles, dataFresh = false } = {}) {
  const config = premiumSettings(timeframe);
  if (!dataFresh) return { status: 'WAIT', reason: 'Live data stale or unavailable', timeframe };
  if (!Array.isArray(candles) || candles.length < 220) {
    return { status: 'WAIT', reason: 'Insufficient history for EMA 200', timeframe };
  }
  if (candles.some(c => !c || ![c.open,c.high,c.low,c.close].every(v => typeof v === 'number' && Number.isFinite(v)) || c.high < c.low)) {
    return { status: 'WAIT', reason: 'Invalid OHLC candles', timeframe };
  }
  const { period, multiplier } = config.supertrend;
  const trend = trendIndicators(candles, period, multiplier, config.adx.period);
  const momentum = momentumSignals(candles);
  // Existing momentum engine treats last candle as forming. Do not generate
  // a trade decision here: its inputs and market-session checks belong to app.js.
  return { status: 'READY', timeframe, config, trend, momentum };
}
