import { indicators } from './market.js';
import { trendIndicators } from './trend-indicators.js';
import { analyseAdvancedIndicators } from './smrt-advanced-indicators.js';
import { analyseFeatures } from './map-feature-calculations.js';
import { supportResistance } from './support-resistance.js';
const present=v=>v!==null&&v!==undefined&&v!==''&&(typeof v!=='number'||Number.isFinite(v));
const display=v=>!present(v)?'Unavailable':typeof v==='number'?v.toFixed(2):Array.isArray(v)?v.slice(-3).map(display).join(' | '):typeof v==='object'?Object.entries(v).filter(([k])=>!['candles','data','history','series'].includes(k)).map(([k,x])=>k+': '+display(x)).join(' · '):String(v);
export function mapIndicatorRows(candles,state={},options={}){
 const rows=[],add=(name,value,reason='',status=null)=>rows.push({name,value,status:status||(present(value)?'READY':'WAIT'),reason});
 const safe=Array.isArray(candles)&&candles.every((b,i)=>b&&['time','open','high','low','close'].every(k=>present(b[k])&&Number.isFinite(Number(b[k])))&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low&&(!i||b.time>candles[i-1].time))?candles:[];
 const calc=indicators(safe),trend=trendIndicators(safe),tech=analyseAdvancedIndicators(safe);
 const vwap=calc.vwap?.at(-1)??(state.futuresVWAPUpdated&&Date.now()-state.futuresVWAPUpdated<120000?state.futuresVWAP:null);
 const f=analyseFeatures(safe,{ema:calc.e21?.at(-1),vwap});
 const sr=supportResistance(safe,{...options,now:options.now??Date.now()/1000});
 for(const [name,key] of Object.entries({'EMA 9':'e9','EMA 21':'e21','EMA 50':'e50','EMA 200':'e200','SMA 50':'s50','SMA 200':'s200','RSI':'rsi','MACD':'macd','MACD signal':'signal','MACD histogram':'hist','Bollinger Bands':'bb','Index VWAP':'vwap'}))add(name,calc[key]?.at(-1),'Real closed candles; sufficient history required');
 for(const [name,key] of Object.entries({'Supertrend':'supertrend','ADX':'adx','+DI':'plusDI','−DI':'minusDI','ATR':'atr'}))add(name,trend[key]?.at(-1));
 const names={ibs:'Internal Bar Strength',ichimoku:'Ichimoku Cloud',ppo:'PPO',specialK:'Special K',pvo:'PVO',qstick:'Qstick',rsi:'Advanced RSI',rvi:'Relative Vigor Index',stochastic:'Stochastic',stochasticRsi:'Stochastic RSI',tdSequential:'TD Sequential',ultimateOscillator:'Ultimate Oscillator',williamsR:'Williams %R',awesomeOscillator:'Awesome Oscillator',chaikin:'Chaikin Oscillator',connorsRsi:'Connors RSI',coppock:'Coppock Curve',ehlersFisher:'Ehlers Fisher',elderRay:'Elder Ray',fisher:'Fisher Transform'};
 for(const [key,name] of Object.entries(names)){const row=tech[key];add(name,row?.value,row?.reason||'Warming up',present(row?.value)?row?.signal||'READY':'WAIT');}
 for(const [name,key] of Object.entries({'Keltner Channel':'keltner','Choppiness Index':'choppiness','Aroon Up/Down':'aroon','CCI':'cci','MFI':'mfi','OBV':'obv','CMF':'cmf','Volume Profile POC/VAH/VAL':'volumeProfile','Daily Pivots / CPR / previous-day HLC':'previousDay','Weekly Pivots / CPR / previous-week HL':'previousWeek','Opening Range Breakout':'orb','Opening Gap':'gap','Swing High/Low':'swings','Breakout direction':'breakout','Retest direction':'retest','False Breakout':'falseBreakout','Relative Volume':'relativeVolume','Volume Spike':'volumeSpike','Market Regime':'regime','Session Quality':'sessionQuality','EMA distance (ATR)':'emaDistance','VWAP distance (ATR)':'vwapDistance'}))add(name,f[key],f.ready?'Context calculation; does not change restored signal rules':'Needs 30 valid closed candles');
 add('Support',sr.support);add('Resistance',sr.resistance);add('Futures VWAP',vwap===calc.vwap?.at(-1)?null:vwap,'Verified futures feed required');
 if(safe.length>=20){const tail=safe.slice(-20);add('Donchian Channel (closed 20-bar range)',{upper:Math.max(...tail.map(b=>b.high)),lower:Math.min(...tail.map(b=>b.low))});}else add('Donchian Channel',null,'Needs 20 closed candles');
 const engines={'NIFTY Edge':state.niftyEdge?.latest,'Market Map':state.marketMap,'Momentum Engine':state.momentum,'Efficiency Engine':state.efficiencyEngine,'Session Quality Engine':state.sessionQuality,'Candle Scanner':state.candleScanner,'Gainz SSL':state.gainzSSL?.latest,'Risk Engine':state.riskEngine,'Trade Finalizer':state.tradeFinalizer,'AI Indicator':state.aiIndicator,'AI NIFTY':state.aiNifty,'Global Watch':state.globalWatch,'Pro Suite':state.proSuite,'Chart Consensus':state.chartConsensus,'All Indicators Consensus':state.allIndicatorsConsensus,'Liquidity Trap':state.liquidityTrap};
 for(const [name,e] of Object.entries(engines))add(name,e?{state:e.state??e.signal??e.action??e.overall??e.trend??'Context',score:e.score??e.confidence??null}:null,e?.reason||e?.reasons?.join(' · ')||'Existing engine output',e?.ready===false?'WAIT':null);
 for(const tf of ['5m','15m','1h'])add(tf+' Confirmation',state.mtf?.[tf]??state.primeMarket?.mtf?.[tf]??null,'Existing multi-timeframe confirmation');
 const structure=state.primeMarket?.structure;
 for(const [name,key] of Object.entries({'Market Structure BOS / CHoCH':'events','HH / HL / LH / LL':'swings','Order Blocks':'blocks','Fair Value Gaps':'gaps','Liquidity Sweeps':'sweeps','Supply & Demand (order-block zones)':'blocks'}))add(name,structure?.[key]??null,'Existing closed-candle structure engine');
 add('Premium / Equilibrium / Discount',structure?.zone??null);
 add('Equilibrium level',structure?.equilibrium??null);
 add('Volume / buy-sell pressure',state.primeMarket?.volume??null,'OHLCV pressure proxy; not exchange bid/ask delta');
 add('Trade plan: Entry / Stop / T1 / T2 / T3',state.tradeFinalizer?.plan??null,'Only existing approved plans are shown');
 add('Invalidation',state.tradeFinalizer?.invalidation??null);
 add('Confidence (0–100)',state.allIndicatorsConsensus?.confidence??null,'Existing confluence score, not profit probability');
 add('Signal explanation',state.tradeFinalizer?.reasons??null);
 add('No-Trade context checks',f.reasons??null,'Additional context only; restored gates remain authoritative');
 add('Backtest / replay metrics',state.niftyEdgeBacktest??state.proBacktest??null,'Existing recorded engine results only; no demo performance');
 return rows;
}
export function renderMapIndicators(candles,state,options){
 const host=document.getElementById('market-map-all-indicators');if(!host)return;
 const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse;font-size:12px';
 const head=document.createElement('tr');for(const t of ['Indicator','Status','Value','Reason']){const th=document.createElement('th');th.textContent=t;th.style.cssText='text-align:left;padding:8px;border-bottom:1px solid #526078';head.append(th);}table.append(head);
 for(const row of mapIndicatorRows(candles,state,options)){const tr=document.createElement('tr');for(const v of [row.name,row.status,display(row.value),row.reason]){const td=document.createElement('td');td.textContent=v;td.style.cssText='padding:8px;border-bottom:1px solid #526078;max-width:320px;overflow-wrap:anywhere';tr.append(td);}table.append(tr);}host.replaceChildren(table);
}
