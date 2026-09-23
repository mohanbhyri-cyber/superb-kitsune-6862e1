// Compact rule-based market chat using only the current SMRT Algo Pro state.

const money = value =>
  Number.isFinite(value)
    ? '₹' +
      value.toLocaleString(
        'en-IN',
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      )
    : '—';

const decimal = value =>
  Number.isFinite(value)
    ? value.toFixed(1)
    : '—';

const sideText = side =>
  side === 1
    ? 'bullish'
    : side === -1
      ? 'bearish'
      : 'neutral';


export function marketChatAnswer(
  question,
  data
) {

  if (!data?.ready) {
    return 'NIFTY candle data is not available yet. Wait for the live Upstox feed to load.';
  }


  const q =
    question
      .toLowerCase();


  const context =
    `NIFTY 50 · ${data.timeframe} · ${data.candleTime} IST. `;


  const setup =
    `Trade Finalizer: ${data.finalizer} (${data.finalizerScore}/100). NIFTY EDGE: ${data.signal}. MTF: ${data.mtf}.`;


  const indicators =
    `RSI 14: ${decimal(data.rsi)}; EMA 9/21/50: ${money(data.ema9)} / ${money(data.ema21)} / ${money(data.ema50)}; MACD histogram: ${decimal(data.macdHist)}; Supertrend: ${sideText(data.trend)}; ADX: ${decimal(data.adx)}.`;


  const levels =
    `Support: ${money(data.support)}; resistance: ${money(data.resistance)}; session high: ${money(data.high)}; session low: ${money(data.low)}; NIFTY futures VWAP: ${money(data.futuresVWAP)}.`;


  const ssl =
    `Gainz SSL signal: ${data.sslSignal}. SSL direction: ${sideText(data.sslState)}. QQE: ${sideText(data.qqeState)} (value ${decimal(data.qqeValue)}).`;


  let answer;


  if (
    /ssl|qqe|gainz/.test(
      q
    )
  ) {

    answer =
      ssl +
      ' ' +
      setup;

  } else if (
    /support|resistance|level|vwap|high|low/.test(
      q
    )
  ) {

    answer =
      levels +
      ' Market Map: ' +
      data.marketState +
      '.';

  } else if (
    /rsi|ema|macd|adx|supertrend|indicator/.test(
      q
    )
  ) {

    answer =
      indicators;

  } else if (
    /trend|structure|market state/.test(
      q
    )
  ) {

    answer =
      `Trend: ${data.marketState}; structure: ${data.structure}; Supertrend: ${sideText(data.trend)}. ` +
      levels;

  } else if (
    /why.*no trade|no trade|wait/.test(
      q
    )
  ) {

    answer =
      setup +
      ' ' +
      ssl +
      ' NO TRADE is shown when the latest closed-candle confirmations do not align strongly enough or higher-timeframe evidence conflicts.';

  } else if (
    /buy|sell|entry|stop|target|trade|setup|final/.test(
      q
    )
  ) {

    answer =
      setup +
      ' ' +
      (
        data.plan
          ? `Current plan: entry ${money(data.plan.entry)}, stop ${money(data.plan.stop)}, TP1 ${money(data.plan.target1)}, TP2 ${money(data.plan.target2)}, TP3 ${money(data.plan.target3)}.`
          : 'No active entry/stop/target plan is confirmed on the latest closed candle.'
      ) +
      ' This is technical decision-support, not an order recommendation.';

  } else {

    answer =
      `Last price ${money(data.price)}. ${setup} ${ssl} ${levels}`;
  }


  return context +
    answer;
}


export function setupMarketChat(
  getSnapshot
) {

  const form =
    document.querySelector(
      '#market-chat-form'
    );

  const input =
    document.querySelector(
      '#market-chat-input'
    );

  const messages =
    document.querySelector(
      '#market-chat-messages'
    );


  if (
    !form ||
    !input ||
    !messages
  ) {
    return;
  }


  const add =
    (
      role,
      value
    ) => {

      const item =
        document.createElement(
          'div'
        );

      item.className =
        'market-chat-message ' +
        role;

      item.textContent =
        value;

      messages.append(
        item
      );

      messages.scrollTop =
        messages.scrollHeight;
    };


  const ask =
    question => {

      const value =
        question
          .trim()
          .slice(
            0,
            240
          );

      if (!value) {
        return;
      }


      add(
        'user',
        value
      );

      add(
        'assistant',
        marketChatAnswer(
          value,
          getSnapshot()
        )
      );
    };


  form.addEventListener(
    'submit',
    event => {

      event.preventDefault();

      ask(
        input.value
      );

      input.value =
        '';

      input.focus();
    }
  );


  document
    .querySelectorAll(
      '[data-market-question]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => ask(
            button.dataset
              .marketQuestion
          )
        );
      }
    );
}
