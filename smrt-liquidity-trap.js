// smrt-liquidity-trap.js
// Detects failed breakouts / liquidity traps from completed candles only.
// Context detector: never creates an order by itself.

const finite=v=>Number.isFinite(Number(v));

export function analyseLiquidityTrap(candles,{lookback=20,atr=null}={}){
  if(!Array.isArray(candles)||candles.length<lookback+4)
    return {ready:false,state:'WARMING UP',side:0,score:0};

  // app indicatorData keeps the final slot as forming/synthetic.
  const i=candles.length-2;
  const c=candles[i], p=candles[i-1];
  if(!c||!p) return {ready:false,state:'WARMING UP',side:0,score:0};

  const start=Math.max(0,i-lookback);
  const prior=candles.slice(start,i);
  const priorHigh=Math.max(...prior.map(x=>Number(x.high)).filter(finite));
  const priorLow=Math.min(...prior.map(x=>Number(x.low)).filter(finite));
  if(!finite(priorHigh)||!finite(priorLow))
    return {ready:false,state:'UNAVAILABLE',side:0,score:0};

  const o=Number(c.open),h=Number(c.high),l=Number(c.low),cl=Number(c.close);
  const range=Math.max(0.000001,h-l);
  const body=Math.abs(cl-o)/range;
  const a=finite(atr)&&Number(atr)>0?Number(atr):null;

  // Bear trap: sell-side liquidity swept, then candle closes back above level.
  const sweptLow=l<priorLow;
  const reclaimedLow=sweptLow&&cl>priorLow;
  // Bull trap: buy-side liquidity swept, then candle closes back below level.
  const sweptHigh=h>priorHigh;
  const rejectedHigh=sweptHigh&&cl<priorHigh;

  let side=0,state='NO CONFIRMED TRAP',score=0,level=null;
  const reasons=[];

  if(reclaimedLow&&!rejectedHigh){
    side=1; state='BULLISH TRAP DETECTED'; level=priorLow;
    score=55;
    reasons.push('Prior liquidity low swept and reclaimed');
    if(cl>o){score+=15;reasons.push('Reclaim candle closed bullish');}
    if(body>=0.45){score+=10;reasons.push('Strong reclaim body');}
    if(a&&priorLow-l>=a*.15){score+=10;reasons.push('Meaningful ATR-normalized sweep');}
    if(Number(p.close)<=priorLow&&cl>priorLow){score+=10;reasons.push('Close confirmed back above level');}
  } else if(rejectedHigh&&!reclaimedLow){
    side=-1; state='BEARISH TRAP DETECTED'; level=priorHigh;
    score=55;
    reasons.push('Prior liquidity high swept and rejected');
    if(cl<o){score+=15;reasons.push('Rejection candle closed bearish');}
    if(body>=0.45){score+=10;reasons.push('Strong rejection body');}
    if(a&&h-priorHigh>=a*.15){score+=10;reasons.push('Meaningful ATR-normalized sweep');}
    if(Number(p.close)>=priorHigh&&cl<priorHigh){score+=10;reasons.push('Close confirmed back below level');}
  } else if(sweptHigh||sweptLow){
    state='SWEEP · WAITING CONFIRMATION';
    reasons.push('Liquidity level swept but reclaim/rejection not confirmed');
  }

  return {ready:true,state,side,score:Math.min(100,score),level,priorHigh,priorLow,reasons,time:c.time};
}
