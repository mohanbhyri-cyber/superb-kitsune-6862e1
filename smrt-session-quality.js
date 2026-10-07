// smrt-session-quality.js
// NIFTY intraday session context. Closed-candle context only.
// Does not generate BUY/SELL direction.

const SESSION_START=9*60+15;
const SESSION_END=15*60+30;

function ist(time){
  const p=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',
    weekday:'short',hour12:false
  }).formatToParts(new Date(Number(time)*1000));
  const get=t=>p.find(x=>x.type===t)?.value||'';
  return {minutes:Number(get('hour'))*60+Number(get('minute')),weekday:get('weekday')};
}

export function analyseSessionQuality(candles, seconds = 60){
  if(!Array.isArray(candles)||candles.length<3)
    return {ready:false,state:'WARMING UP',quality:'WAIT',score:0};

  const c=candles[candles.length-2];
  if(!c) return {ready:false,state:'WARMING UP',quality:'WAIT',score:0};

  // Candle timestamps are OPEN times. Session eligibility should use
  // the completed candle's END time so the 09:15/15:30 boundaries are exact.
  const duration=Number(seconds)>0?Number(seconds):60;
  const sessionTime=Number(c.time)+duration;
  const {minutes,weekday}=ist(sessionTime);
  if(['Sat','Sun'].includes(weekday)||minutes<SESSION_START||minutes>=SESSION_END)
    return {ready:true,state:'MARKET CLOSED',quality:'CLOSED',score:0,time:c.time};

  const fromOpen=minutes-SESSION_START;
  let state='NORMAL SESSION',quality='GOOD',score=75;

  // Opening minutes and the final stretch often carry faster price discovery,
  // wider spreads/slippage and event-driven movement. Treat as context/risk,
  // not as a directional signal.
  if(fromOpen<15){
    state='OPENING VOLATILITY';
    quality='CAUTION';
    score=45;
  }else if(fromOpen<45){
    state='OPENING TREND WINDOW';
    quality='GOOD';
    score=80;
  }else if(minutes>=12*60&&minutes<13*60+30){
    state='MIDDAY / LOWER MOMENTUM';
    quality='CAUTION';
    score=55;
  }else if(minutes>=14*60+45){
    state='LATE SESSION';
    quality='CAUTION';
    score=55;
  }

  return {ready:true,state,quality,score,minutes,time:c.time,closedAt:sessionTime};
}
