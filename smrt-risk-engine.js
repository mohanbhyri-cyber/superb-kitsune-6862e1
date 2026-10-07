// smrt-risk-engine.js
// Trade-plan quality control. It does not create BUY/SELL direction.

const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));

export function analyseRisk(plan,{atr=null,side=0,contextFresh=true}={}){
  if(contextFresh!==true)
    return {ready:true,state:'STALE / MISMATCHED DATA',quality:'BLOCK',score:0,reasons:['Current candle context is stale or mismatched']};
  if(!plan) return {ready:false,state:'NO ACTIVE PLAN',quality:'WAIT',score:0};

  const entry=Number(plan.entry);
  const stop=Number(plan.stopLoss ?? plan.stop);
  const t1=Number(plan.target1);
  const t2=Number(plan.target2);
  const t3=Number(plan.target3);

  if(![entry,stop,t1].every(finite)||entry<=0||stop<=0||t1<=0||entry===stop)
    return {ready:true,state:'INVALID PLAN',quality:'BLOCK',score:0,reasons:['Entry, stop or target is invalid']};

  if(side!==1&&side!==-1)
    return {ready:true,state:'INVALID DIRECTION',quality:'BLOCK',score:0,reasons:['Trade direction is unavailable']};

  const risk=Math.abs(entry-stop);
  const rewards=[t1,t2,t3].map(t=>finite(t)?Math.abs(t-entry):null);
  const rr1=rewards[0]/risk;
  const rr2=finite(rewards[1])?rewards[1]/risk:null;
  const rr3=finite(rewards[2])?rewards[2]/risk:null;
  const atrRisk=finite(atr)&&Number(atr)>0?risk/Number(atr):null;

  const directionValid=side===1
    ? stop<entry&&t1>entry
    : side===-1
      ? stop>entry&&t1<entry
      : false;

  let score=100;
  const reasons=[];

  if(!directionValid){score=0;reasons.push('Stop/target direction invalid');}
  if(rr1<1){score-=35;reasons.push('T1 reward is below 1R');}
  else if(rr1<1.25){score-=15;reasons.push('T1 reward is marginal');}

  if(atrRisk!==null){
    if(atrRisk<0.45){score-=25;reasons.push('Stop is very tight versus ATR');}
    else if(atrRisk>2.5){score-=20;reasons.push('Stop is wide versus ATR');}
  }

  score=Math.max(0,Math.min(100,Math.round(score)));
  const quality=!directionValid||score<50?'BLOCK':score<70?'CAUTION':'GOOD';
  const state=quality==='BLOCK'?'POOR RISK SETUP':quality==='CAUTION'?'RISK CAUTION':'RISK ACCEPTABLE';

  return {ready:true,state,quality,score,risk,rr1,rr2,rr3,atrRisk,reasons};
}
