// Rule-based answers from the same NIFTY state used by the chart.
const money = value => Number.isFinite(value)
  ? '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
  : '—';
const decimal = value => Number.isFinite(value) ? value.toFixed(1) : '—';

export function marketChatAnswer(question, data) {
  if (!data?.ready) {
    return 'NIFTY candle data is not available yet. Wait for the Upstox feed, then ask again. No sample prices are used here.';
  }

  const context = `NIFTY 50 · ${data.timeframe} · latest chart candle ${data.candleTime} IST. `;
  const q = question.toLowerCase();
  const signal = data.signal || 'WAIT';
  const trend = data.trend === 1 ? 'bullish' : data.trend === -1 ? 'bearish' : 'unconfirmed';
  const smart = `Smart Signal: ${signal} (${data.strength || 'none'} strength, confluence ${data.confluence ?? '—'}). Market: ${data.marketState || 'WAIT'}.`;
  const indicators = `RSI 14: ${decimal(data.rsi)}; EMA 9: ${money(data.ema9)}; EMA 21: ${money(data.ema21)}; MACD histogram: ${decimal(data.macdHist)}; Supertrend: ${trend}; ADX: ${decimal(data.adx)}.`;
  const levels = `Session high ${money(data.high)}, low ${money(data.low)}. NIFTY futures VWAP: ${money(data.futuresVWAP)}${Number.isFinite(data.futuresVWAP) ? '' : ' (unavailable)'}.`;
  const backtest = data.backtest
    ? `Historical simulation: ${data.backtest.trades ?? 0} trades, ${decimal(data.backtest.winRate)}% win rate, ${decimal(data.backtest.netPoints)} net points. Past results do not predict future returns.`
    : 'Backtest data is unavailable.';

  let answer;
  if (/backtest|win rate|performance|historical/.test(q)) answer = backtest;
  else if (/level|support|resistance|high|low|vwap/.test(q)) answer = levels;
  else if (/rsi|ema|macd|adx|indicator|momentum|supertrend/.test(q)) answer = indicators;
  else if (/buy|sell|signal|entry|stop|target|trade|why wait|\bwait\b/.test(q)) {
    const explanation = signal === 'WAIT' && Number.isFinite(data.confluence)
      ? `The Smart Signal rule needs at least 5 aligned votes; the highest side has ${data.confluence}. Bullish votes: ${data.bullishScore ?? '—'}, bearish votes: ${data.bearishScore ?? '—'}. `
      : '';
    answer = smart + ' ' + explanation + (data.plan
      ? `Plan shown by Pro Suite: entry ${money(data.plan.entry)}, stop ${money(data.plan.stop)}, targets ${money(data.plan.target1)} and ${money(data.plan.target2)}.`
      : 'No trade plan is active.') + ' This is analysis, not a recommendation to place an order.';
  } else if (/trend|market state|structure/.test(q)) {
    answer = `Market: ${data.marketState || 'WAIT'}; Supertrend: ${trend}; structure: ${data.structure || '—'}. ADX ${decimal(data.adx)} and directional indicators are based on the latest closed candle.`;
  } else if (/help|what can|question/.test(q)) {
    answer = 'Ask about the market summary, trend, indicators, levels, Smart Signal, trade plan, or backtest.';
  } else {
    answer = `Last price ${money(data.price)}. ${smart} ${indicators} Ask about levels or backtest for more detail.`;
  }
  return context + answer;
}

export function setupMarketChat(getSnapshot) {
  const form = document.querySelector('#market-chat-form');
  const input = document.querySelector('#market-chat-input');
  const messages = document.querySelector('#market-chat-messages');
  if (!form || !input || !messages) return;

  const add = (role, value) => {
    const item = document.createElement('div');
    item.className = 'market-chat-message ' + role;
    item.textContent = value;
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
  };

  const ask = question => {
    const value = question.trim().slice(0, 240);
    if (!value) return;
    add('user', value);
    add('assistant', marketChatAnswer(value, getSnapshot()));
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    ask(input.value);
    input.value = '';
    input.focus();
  });
  document.querySelectorAll('[data-market-question]').forEach(button => {
    button.addEventListener('click', () => ask(button.dataset.marketQuestion));
  });
}

