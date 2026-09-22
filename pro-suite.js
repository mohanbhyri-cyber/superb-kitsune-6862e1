// pro-suite.js
// ============================================================
// STRIDE PRO TRADING SUITE
// Original implementation for NIFTY 50 analysis
// ATR + Supertrend + ADX/DMI + Market Structure
// BOS / CHoCH + Smart BUY/SELL + Trade Plan + Backtest
// ============================================================


// ============================================================
// BASIC HELPERS
// ============================================================

function finite(value) {
  return Number.isFinite(Number(value));
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


// ============================================================
// SMA
// ============================================================

export function sma(
  values,
  period
) {

  const out = [];

  let sum = 0;

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const value =
      Number(values[i]);

    sum += value;

    if (
      i >= period
    ) {

      sum -=
        Number(
          values[
            i - period
          ]
        );
    }

    out.push(
      i >= period - 1
        ? sum / period
        : null
    );
  }

  return out;
}


// ============================================================
// EMA
// ============================================================

export function ema(
  values,
  period
) {

  if (
    !Array.isArray(values) ||
    !values.length
  ) {

    return [];
  }

  const output = [];

  const multiplier =
    2 /
    (
      period + 1
    );

  let last =
    Number(
      values[0]
    );

  for (
    let i = 0;
    i < values.length;
    i++
  ) {

    const value =
      Number(
        values[i]
      );

    if (
      i === 0
    ) {

      last =
        value;

    } else {

      last =
        value *
        multiplier +
        last *
        (
          1 -
          multiplier
        );
    }

    output.push(
      last
    );
  }

  return output;
}


// ============================================================
// TRUE RANGE
// ============================================================

export function trueRange(
  candle,
  previous
) {

  if (!previous) {

    return (
      candle.high -
      candle.low
    );
  }

  return Math.max(
    candle.high -
      candle.low,

    Math.abs(
      candle.high -
      previous.close
    ),

    Math.abs(
      candle.low -
      previous.close
    )
  );
}


// ============================================================
// ATR
// Wilder ATR
// ============================================================

export function atr(
  candles,
  period = 14
) {

  const out = [];

  let smoothed = null;

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    const tr =
      trueRange(
        candles[i],
        i > 0
          ? candles[
              i - 1
            ]
          : null
      );

    if (
      i <
      period - 1
    ) {

      out.push(
        null
      );

      continue;
    }


    if (
      i ===
      period - 1
    ) {

      let total = 0;

      for (
        let j = 0;
        j < period;
        j++
      ) {

        total +=
          trueRange(
            candles[j],
            j > 0
              ? candles[
                  j - 1
                ]
              : null
          );
      }

      smoothed =
        total /
        period;

    } else {

      smoothed =
        (
          smoothed *
          (
            period - 1
          ) +
          tr
        ) /
        period;
    }

    out.push(
      smoothed
    );
  }

  return out;
}


// ============================================================
// RSI
// ============================================================

export function rsi(
  values,
  period = 14
) {

  const output =
    Array(
      values.length
    ).fill(
      null
    );

  if (
    values.length <=
    period
  ) {

    return output;
  }

  let gain = 0;
  let loss = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const change =
      values[i] -
      values[
        i - 1
      ];

    if (
      change >= 0
    ) {

      gain +=
        change;

    } else {

      loss +=
        Math.abs(
          change
        );
    }
  }

  let avgGain =
    gain /
    period;

  let avgLoss =
    loss /
    period;

  const calc =
    () => {

      if (
        avgLoss === 0
      ) {

        return 100;
      }

      const rs =
        avgGain /
        avgLoss;

      return (
        100 -
        100 /
        (
          1 + rs
        )
      );
    };


  output[
    period
  ] =
    calc();


  for (
    let i =
      period + 1;
    i <
      values.length;
    i++
  ) {

    const change =
      values[i] -
      values[
        i - 1
      ];

    const currentGain =
      change > 0
        ? change
        : 0;

    const currentLoss =
      change < 0
        ? Math.abs(
            change
          )
        : 0;


    avgGain =
      (
        avgGain *
        (
          period - 1
        ) +
        currentGain
      ) /
      period;


    avgLoss =
      (
        avgLoss *
        (
          period - 1
        ) +
        currentLoss
      ) /
      period;


    output[i] =
      calc();
  }

  return output;
}


// ============================================================
// MACD
// ============================================================

export function macd(
  values,
  fast = 12,
  slow = 26,
  signal = 9
) {

  const fastEMA =
    ema(
      values,
      fast
    );

  const slowEMA =
    ema(
      values,
      slow
    );

  const macdLine =
    values.map(
      (
        _,
        i
      ) =>
        fastEMA[i] -
        slowEMA[i]
    );

  const signalLine =
    ema(
      macdLine,
      signal
    );

  return macdLine.map(
    (
      value,
      i
    ) => ({

      macd:
        value,

      signal:
        signalLine[i],

      histogram:
        value -
        signalLine[i]
    })
  );
}


// ============================================================
// SUPERTREND
// Default: ATR 10, multiplier 3
// ============================================================

export function supertrend(
  candles,
  period = 10,
  multiplier = 3
) {

  const atrValues =
    atr(
      candles,
      period
    );

  const output =
    [];

  let finalUpper =
    null;

  let finalLower =
    null;

  let direction =
    1;


  for (
    let i = 0;
    i <
      candles.length;
    i++
  ) {

    const candle =
      candles[i];

    const atrValue =
      atrValues[i];


    if (
      !finite(
        atrValue
      )
    ) {

      output.push(
        null
      );

      continue;
    }


    const hl2 =
      (
        candle.high +
        candle.low
      ) /
      2;


    const basicUpper =
      hl2 +
      multiplier *
      atrValue;


    const basicLower =
      hl2 -
      multiplier *
      atrValue;


    if (
      finalUpper ===
      null
    ) {

      finalUpper =
        basicUpper;

      finalLower =
        basicLower;

    } else {

      const previous =
        candles[
          i - 1
        ];


      finalUpper =
        basicUpper <
          finalUpper ||
        previous.close >
          finalUpper

          ? basicUpper
          : finalUpper;


      finalLower =
        basicLower >
          finalLower ||
        previous.close <
          finalLower

          ? basicLower
          : finalLower;
    }


    if (
      direction === 1 &&
      candle.close <
      finalLower
    ) {

      direction =
        -1;

    } else if (
      direction === -1 &&
      candle.close >
      finalUpper
    ) {

      direction =
        1;
    }


    output.push({

      direction,

      value:
        direction === 1
          ? finalLower
          : finalUpper,

      atr:
        atrValue
    });
  }

  return output;
}


// ============================================================
// ADX / +DI / -DI
// Wilder style
// ============================================================

export function adxDmi(
  candles,
  period = 14
) {

  const length =
    candles.length;

  const output =
    Array(
      length
    ).fill(
      null
    );

  if (
    length <
    period + 2
  ) {

    return output;
  }


  const tr =
    Array(
      length
    ).fill(
      0
    );

  const plusDM =
    Array(
      length
    ).fill(
      0
    );

  const minusDM =
    Array(
      length
    ).fill(
      0
    );


  for (
    let i = 1;
    i < length;
    i++
  ) {

    const current =
      candles[i];

    const previous =
      candles[
        i - 1
      ];


    tr[i] =
      trueRange(
        current,
        previous
      );


    const upMove =
      current.high -
      previous.high;


    const downMove =
      previous.low -
      current.low;


    plusDM[i] =
      upMove >
        downMove &&
      upMove > 0

        ? upMove
        : 0;


    minusDM[i] =
      downMove >
        upMove &&
      downMove > 0

        ? downMove
        : 0;
  }


  let trSmooth = 0;
  let plusSmooth = 0;
  let minusSmooth = 0;


  for (
    let i = 1;
    i <= period;
    i++
  ) {

    trSmooth +=
      tr[i];

    plusSmooth +=
      plusDM[i];

    minusSmooth +=
      minusDM[i];
  }


  const dx =
    Array(
      length
    ).fill(
      null
    );


  for (
    let i = period;
    i < length;
    i++
  ) {

    if (
      i > period
    ) {

      trSmooth =
        trSmooth -
        trSmooth /
        period +
        tr[i];


      plusSmooth =
        plusSmooth -
        plusSmooth /
        period +
        plusDM[i];


      minusSmooth =
        minusSmooth -
        minusSmooth /
        period +
        minusDM[i];
    }


    const plusDI =
      trSmooth > 0
        ? 100 *
          plusSmooth /
          trSmooth
        : 0;


    const minusDI =
      trSmooth > 0
        ? 100 *
          minusSmooth /
          trSmooth
        : 0;


    const denominator =
      plusDI +
      minusDI;


    const currentDX =
      denominator > 0
        ? 100 *
          Math.abs(
            plusDI -
            minusDI
          ) /
          denominator
        : 0;


    dx[i] =
      currentDX;


    output[i] = {

      adx:
        null,

      plusDI,

      minusDI
    };
  }


  let adxValue =
    null;


  const firstADXIndex =
    period * 2 -
    1;


  if (
    firstADXIndex <
    length
  ) {

    let totalDX = 0;
    let count = 0;


    for (
      let i = period;
      i <=
        firstADXIndex;
      i++
    ) {

      if (
        finite(
          dx[i]
        )
      ) {

        totalDX +=
          dx[i];

        count++;
      }
    }


    if (
      count > 0
    ) {

      adxValue =
        totalDX /
        count;


      output[
        firstADXIndex
      ].adx =
        adxValue;
    }


    for (
      let i =
        firstADXIndex +
        1;
      i < length;
      i++
    ) {

      if (
        !output[i] ||
        !finite(
          dx[i]
        )
      ) {

        continue;
      }


      adxValue =
        (
          adxValue *
          (
            period - 1
          ) +
          dx[i]
        ) /
        period;


      output[i].adx =
        adxValue;
    }
  }

  return output;
}


// ============================================================
// SWING HIGH / SWING LOW
// ============================================================

export function swingPoints(
  candles,
  lookback = 3
) {

  const output =
    Array(
      candles.length
    ).fill(
      null
    );


  for (
    let i = lookback;
    i <
      candles.length -
      lookback;
    i++
  ) {

    const candle =
      candles[i];

    let high =
      true;

    let low =
      true;


    for (
      let j =
        i - lookback;
      j <=
        i + lookback;
      j++
    ) {

      if (
        j === i
      ) {

        continue;
      }


      if (
        candles[j]
          .high >=
        candle.high
      ) {

        high =
          false;
      }


      if (
        candles[j]
          .low <=
        candle.low
      ) {

        low =
          false;
      }
    }


    output[i] = {

      swingHigh:
        high,

      swingLow:
        low
    };
  }

  return output;
}


// ============================================================
// HH / HL / LH / LL
// BOS / CHoCH
// ============================================================

export function marketStructure(
  candles,
  lookback = 3
) {

  const swings =
    swingPoints(
      candles,
      lookback
    );


  const output =
    Array(
      candles.length
    ).fill(
      null
    );


  let previousHigh =
    null;

  let previousLow =
    null;

  let trend =
    0;


  for (
    let i = 0;
    i <
      candles.length;
    i++
  ) {

    const candle =
      candles[i];

    const swing =
      swings[i];


    let structure =
      null;

    let event =
      null;


    if (
      swing?.swingHigh
    ) {

      if (
        previousHigh !==
        null
      ) {

        structure =
          candle.high >
          previousHigh

            ? 'HH'
            : 'LH';
      }


      previousHigh =
        candle.high;
    }


    if (
      swing?.swingLow
    ) {

      if (
        previousLow !==
        null
      ) {

        structure =
          candle.low >
          previousLow

            ? 'HL'
            : 'LL';
      }


      previousLow =
        candle.low;
    }


    if (
      previousHigh !==
        null &&
      candle.close >
      previousHigh
    ) {

      event =
        trend === -1
          ? 'CHOCH_UP'
          : 'BOS_UP';


      trend =
        1;
    }


    if (
      previousLow !==
        null &&
      candle.close <
      previousLow
    ) {

      event =
        trend === 1
          ? 'CHOCH_DOWN'
          : 'BOS_DOWN';


      trend =
        -1;
    }


    output[i] = {

      structure,

      event,

      trend,

      lastSwingHigh:
        previousHigh,

      lastSwingLow:
        previousLow
    };
  }

  return output;
}


// ============================================================
// SUPPORT / RESISTANCE
// ============================================================

export function supportResistance(
  candles,
  lookback = 50
) {

  if (
    !candles.length
  ) {

    return {
      support: null,
      resistance: null
    };
  }


  const rows =
    candles.slice(
      -lookback
    );


  return {

    support:
      Math.min(
        ...rows.map(
          c =>
            Number(
              c.low
            )
        )
      ),

    resistance:
      Math.max(
        ...rows.map(
          c =>
            Number(
              c.high
            )
        )
      )
  };
}


// ============================================================
// LIQUIDITY SWEEP DETECTION
// ============================================================

export function liquiditySweep(
  candles,
  structure
) {

  const output =
    Array(
      candles.length
    ).fill(
      null
    );


  for (
    let i = 1;
    i <
      candles.length;
    i++
  ) {

    const candle =
      candles[i];

    const info =
      structure[i];


    if (!info) {
      continue;
    }


    const high =
      info.lastSwingHigh;

    const low =
      info.lastSwingLow;


    let sweep =
      null;


    if (
      finite(high) &&
      candle.high >
        high &&
      candle.close <
        high
    ) {

      sweep =
        'SELL_SIDE_REVERSAL';
    }


    if (
      finite(low) &&
      candle.low <
        low &&
      candle.close >
        low
    ) {

      sweep =
        'BUY_SIDE_REVERSAL';
    }


    output[i] =
      sweep;
  }

  return output;
}


// ============================================================
// MOMENTUM DIRECTION
// ============================================================

export function momentumDirection(
  closes,
  period = 10
) {

  return closes.map(
    (
      close,
      i
    ) => {

      if (
        i < period
      ) {

        return 0;
      }

      const previous =
        closes[
          i - period
        ];


      if (
        close >
        previous
      ) {

        return 1;
      }


      if (
        close <
        previous
      ) {

        return -1;
      }


      return 0;
    }
  );
}


// ============================================================
// SMART SIGNAL ENGINE
// ============================================================

export function smartSignal({

  strideDirection = 0,

  supertrendDirection = 0,

  adx = 0,

  plusDI = 0,

  minusDI = 0,

  momentumDirection = 0,

  structureEvent = null,

  rsiValue = null,

  macdHistogram = null,

  liquidityEvent = null

}) {

  let bullish =
    0;

  let bearish =
    0;


  // STRIDE

  if (
    strideDirection === 1
  ) {

    bullish++;
  }


  if (
    strideDirection === -1
  ) {

    bearish++;
  }


  // SUPERTREND

  if (
    supertrendDirection === 1
  ) {

    bullish++;
  }


  if (
    supertrendDirection === -1
  ) {

    bearish++;
  }


  // ADX DMI

  if (
    adx >= 20 &&
    plusDI >
    minusDI
  ) {

    bullish++;
  }


  if (
    adx >= 20 &&
    minusDI >
    plusDI
  ) {

    bearish++;
  }


  // MOMENTUM

  if (
    momentumDirection === 1
  ) {

    bullish++;
  }


  if (
    momentumDirection === -1
  ) {

    bearish++;
  }


  // STRUCTURE

  if (
    structureEvent ===
      'BOS_UP' ||
    structureEvent ===
      'CHOCH_UP'
  ) {

    bullish++;
  }


  if (
    structureEvent ===
      'BOS_DOWN' ||
    structureEvent ===
      'CHOCH_DOWN'
  ) {

    bearish++;
  }


  // RSI FILTER

  if (
    finite(
      rsiValue
    )
  ) {

    if (
      rsiValue >
      52
    ) {

      bullish++;
    }


    if (
      rsiValue <
      48
    ) {

      bearish++;
    }
  }


  // MACD

  if (
    finite(
      macdHistogram
    )
  ) {

    if (
      macdHistogram >
      0
    ) {

      bullish++;
    }


    if (
      macdHistogram <
      0
    ) {

      bearish++;
    }
  }


  // LIQUIDITY SWEEP

  if (
    liquidityEvent ===
    'BUY_SIDE_REVERSAL'
  ) {

    bullish++;
  }


  if (
    liquidityEvent ===
    'SELL_SIDE_REVERSAL'
  ) {

    bearish++;
  }


  let signal =
    'WAIT';

  let strength =
    'NONE';


  const maxScore =
    Math.max(
      bullish,
      bearish
    );


  if (
    bullish >= 5 &&
    bullish >
    bearish
  ) {

    signal =
      'BUY';

    strength =
      bullish >= 7
        ? 'STRONG'
        : 'NORMAL';
  }


  if (
    bearish >= 5 &&
    bearish >
    bullish
  ) {

    signal =
      'SELL';

    strength =
      bearish >= 7
        ? 'STRONG'
        : 'NORMAL';
  }


  return {

    signal,

    strength,

    bullishScore:
      bullish,

    bearishScore:
      bearish,

    confluence:
      maxScore,

    marketState:
      adx >= 25
        ? 'TRENDING'
        : 'RANGING'
  };
}


// ============================================================
// TRADE PLAN
// ============================================================

export function tradePlan({

  signal,

  price,

  atrValue,

  stopATR = 1.2,

  target1ATR = 1.5,

  target2ATR = 2.5

}) {

  if (
    signal ===
      'WAIT' ||
    !finite(
      price
    ) ||
    !finite(
      atrValue
    )
  ) {

    return null;
  }


  const risk =
    atrValue *
    stopATR;


  if (
    signal ===
    'BUY'
  ) {

    return {

      entry:
        price,

      stop:
        price -
        risk,

      target1:
        price +
        atrValue *
        target1ATR,

      target2:
        price +
        atrValue *
        target2ATR,

      rr1:
        target1ATR /
        stopATR,

      rr2:
        target2ATR /
        stopATR
    };
  }


  return {

    entry:
      price,

    stop:
      price +
      risk,

    target1:
      price -
      atrValue *
      target1ATR,

    target2:
      price -
      atrValue *
      target2ATR,

    rr1:
      target1ATR /
      stopATR,

    rr2:
      target2ATR /
      stopATR
  };
}


// ============================================================
// PRO SUITE ANALYSIS
// One function for the entire app
// ============================================================

export function analyseProSuite(
  candles,
  {
    strideSignals = []
  } = {}
) {

  if (
    !Array.isArray(
      candles
    ) ||
    !candles.length
  ) {

    return {
      rows: [],
      latest: null
    };
  }


  const closes =
    candles.map(
      c =>
        Number(
          c.close
        )
    );


  const atrValues =
    atr(
      candles,
      14
    );


  const st =
    supertrend(
      candles,
      10,
      3
    );


  const dmi =
    adxDmi(
      candles,
      14
    );


  const structure =
    marketStructure(
      candles,
      3
    );


  const liquidity =
    liquiditySweep(
      candles,
      structure
    );


  const momentum =
    momentumDirection(
      closes,
      10
    );


  const rsiValues =
    rsi(
      closes,
      14
    );


  const macdValues =
    macd(
      closes
    );


  const rows =
    candles.map(
      (
        candle,
        i
      ) => {

        const stride =
          strideSignals[
            i
          ];


        const smart =
          smartSignal({

            strideDirection:
              stride
                ?.direction ??
              0,

            supertrendDirection:
              st[i]
                ?.direction ??
              0,

            adx:
              dmi[i]
                ?.adx ??
              0,

            plusDI:
              dmi[i]
                ?.plusDI ??
              0,

            minusDI:
              dmi[i]
                ?.minusDI ??
              0,

            momentumDirection:
              momentum[i] ??
              0,

            structureEvent:
              structure[i]
                ?.event ??
              null,

            rsiValue:
              rsiValues[i],

            macdHistogram:
              macdValues[i]
                ?.histogram,

            liquidityEvent:
              liquidity[i]
          });


        const plan =
          tradePlan({

            signal:
              smart.signal,

            price:
              candle.close,

            atrValue:
              atrValues[i]
          });


        return {

          time:
            candle.time,

          close:
            candle.close,

          atr:
            atrValues[i],

          supertrend:
            st[i],

          dmi:
            dmi[i],

          structure:
            structure[i],

          liquidity:
            liquidity[i],

          momentum:
            momentum[i],

          rsi:
            rsiValues[i],

          macd:
            macdValues[i],

          smart,

          plan
        };
      }
    );


  return {

    rows,

    latest:
      rows.at(
        -1
      )
  };
}


// ============================================================
// SIMPLE HISTORICAL BACKTEST
// Analytical simulation only
// ============================================================

export function backtestSmartSignals(
  candles,
  analysisRows
) {

  const trades =
    [];

  let active =
    null;


  for (
    let i = 0;
    i <
      candles.length;
    i++
  ) {

    const candle =
      candles[i];

    const analysis =
      analysisRows[i];


    if (
      !analysis
    ) {

      continue;
    }


    if (
      active
    ) {

      if (
        active.side ===
        'BUY'
      ) {

        const stopHit =
          candle.low <=
          active.stop;


        const targetHit =
          candle.high >=
          active.target1;


        if (
          stopHit ||
          targetHit
        ) {

          const exit =
            stopHit
              ? active.stop
              : active.target1;


          trades.push({

            ...active,

            exit,

            result:
              exit -
              active.entry,

            win:
              targetHit &&
              !stopHit,

            exitTime:
              candle.time
          });


          active =
            null;
        }

      } else {

        const stopHit =
          candle.high >=
          active.stop;


        const targetHit =
          candle.low <=
          active.target1;


        if (
          stopHit ||
          targetHit
        ) {

          const exit =
            stopHit
              ? active.stop
              : active.target1;


          trades.push({

            ...active,

            exit,

            result:
              active.entry -
              exit,

            win:
              targetHit &&
              !stopHit,

            exitTime:
              candle.time
          });


          active =
            null;
        }
      }


      continue;
    }


    const signal =
      analysis.smart
        ?.signal;


    const strength =
      analysis.smart
        ?.strength;


    const plan =
      analysis.plan;


    if (
      !plan ||
      strength ===
        'NONE' ||
      signal ===
        'WAIT'
    ) {

      continue;
    }


    active = {

      side:
        signal,

      strength,

      entry:
        plan.entry,

      stop:
        plan.stop,

      target1:
        plan.target1,

      target2:
        plan.target2,

      entryTime:
        candle.time
    };
  }


  const wins =
    trades.filter(
      t =>
        t.win
    ).length;


  const losses =
    trades.length -
    wins;


  const netPoints =
    trades.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        trade.result,
      0
    );


  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;


  for (
    const trade of
    trades
  ) {

    equity +=
      trade.result;


    peak =
      Math.max(
        peak,
        equity
      );


    maxDrawdown =
      Math.max(
        maxDrawdown,
        peak -
        equity
      );
  }


  const averageRR =
    trades.length
      ? trades.reduce(
          (
            sum,
            trade
          ) => {

            const risk =
              Math.abs(
                trade.entry -
                trade.stop
              );


            const reward =
              Math.abs(
                trade.target1 -
                trade.entry
              );


            return (
              sum +
              (
                risk > 0
                  ? reward /
                    risk
                  : 0
              )
            );
          },
          0
        ) /
        trades.length

      : 0;


  return {

    trades,

    totalTrades:
      trades.length,

    wins,

    losses,

    winRate:
      trades.length
        ? wins /
          trades.length *
          100
        : 0,

    netPoints,

    averageRR,

    maxDrawdown
  };
}


// ============================================================
// END STRIDE PRO TRADING SUITE
// ============================================================
