// SMRT Algo Pro: centralized premium indicator presets (configuration only).
// Integrators should consume these values in indicator calculations; no mock market data.
export const PREMIUM_PRESETS = Object.freeze({
  "1m": { ema:[9,21,50,200], supertrend:{period:10,multiplier:2.5}, adx:{period:14,minStrength:23}, rsi:{period:14,bull:56,bear:44}, macd:[12,26,9], atr:{period:14,stopMultiple:1.5,targetMultiple:2}, bb:{period:20,deviations:2}, keltner:{period:20,multiplier:1.5}, donchian:20, cci:20, mfi:14, cmf:20, obv:true, aroon:25, choppiness:14, rbve:{lookback:20,sensitivity:0.5,alpha:0.1,beta:0.1,smoothing:8,volumeWeight:1,threshold:0.25,range:30,confirmation:5,size:"Small"}, structure:{pivotLength:3,fvgMinAtr:0.2}, entry:{minConfirmations:5,candleClosed:true,requireFreshData:true} },
  "3m": { ema:[9,21,50,200], supertrend:{period:10,multiplier:3}, adx:{period:14,minStrength:22}, rsi:{period:14,bull:55,bear:45}, macd:[12,26,9], atr:{period:14,stopMultiple:1.5,targetMultiple:2}, bb:{period:20,deviations:2}, keltner:{period:20,multiplier:1.5}, donchian:20, cci:20, mfi:14, cmf:20, obv:true, aroon:25, choppiness:14, rbve:{lookback:20,sensitivity:0.5,alpha:0.1,beta:0.1,smoothing:8,volumeWeight:1,threshold:0.25,range:30,confirmation:5,size:"Small"}, structure:{pivotLength:4,fvgMinAtr:0.2}, entry:{minConfirmations:5,candleClosed:true,requireFreshData:true} },
  "5m": { ema:[9,21,50,200], supertrend:{period:10,multiplier:3}, adx:{period:14,minStrength:20}, rsi:{period:14,bull:55,bear:45}, macd:[12,26,9], atr:{period:14,stopMultiple:1.5,targetMultiple:2}, bb:{period:20,deviations:2}, keltner:{period:20,multiplier:1.5}, donchian:20, cci:20, mfi:14, cmf:20, obv:true, aroon:25, choppiness:14, rbve:{lookback:20,sensitivity:0.5,alpha:0.1,beta:0.1,smoothing:8,volumeWeight:1,threshold:0.25,range:30,confirmation:5,size:"Small"}, structure:{pivotLength:5,fvgMinAtr:0.25}, entry:{minConfirmations:5,candleClosed:true,requireFreshData:true} }
});
export function premiumSettings(timeframe="5m") {
  const preset = PREMIUM_PRESETS[timeframe];
  if (!preset) throw new Error("Unsupported premium timeframe");
  return structuredClone(preset);
}
