// smrt-chart-consensus.js
// ============================================================
// SMRT CHART CONSENSUS
// Historical, closed-candle, non-repainting BUY/SELL markers.
// Uses only data that exists at each candle: EMA, Supertrend,
// ADX/DMI, RSI, MACD, VWAP, NIFTY EDGE and SSL+QQE.
// ============================================================

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));


export function analyseChartConsensus({
  candles,
  calc,
  trend,
  edge,
  gainz
} = {}) {

  if (
    !Array.isArray(candles) ||
    !calc ||
    !trend
  ) {
    return {
      rows: [],
      latest: null
    };
  }


  const rows =
    Array(candles.length).fill(null);


  let lastSignalSide = 0;
  let lastSignalIndex = -99;


  // ==========================================================
  // CLOSED-CANDLE PROTECTION
  // ==========================================================
  //
  // The newest candle can still be forming.
  // Therefore historical consensus ends at candle length - 2.
  //
  // This prevents the latest live candle from repainting
  // historical BUY/SELL markers.
  // ==========================================================

  const lastClosed =
    Math.max(
      0,
      candles.length - 2
    );


  for (
    let i = 50;
    i <= lastClosed;
    i++
  ) {

    const candle =
      candles[i];

    if (!candle) {
      continue;
    }


    // ========================================================
    // INDICATOR VALUES AT THIS CANDLE ONLY
    // ========================================================

    const e9 =
      calc.e9?.[i];

    const e21 =
      calc.e21?.[i];

    const e50 =
      calc.e50?.[i];

    const rsi =
      calc.rsi?.[i];

    const hist =
      calc.hist?.[i];

    const vwap =
      calc.vwap?.[i];

    const st =
      trend.direction?.[i] || 0;

    const adx =
      trend.adx?.[i];

    const plus =
      trend.plusDI?.[i];

    const minus =
      trend.minusDI?.[i];


    const close =
      finite(candle.close)
        ? Number(candle.close)
        : null;


    let bull = 0;
    let bear = 0;

    const reasons = [];


    // ========================================================
    // EMA STRUCTURE
    // Weight: 2
    // ========================================================

    if (
      [e9, e21, e50]
        .every(finite)
    ) {

      if (
        Number(e9) >
          Number(e21) &&
        Number(e21) >
          Number(e50)
      ) {

        bull += 2;

        reasons.push(
          'EMA bullish'
        );

      } else if (
        Number(e9) <
          Number(e21) &&
        Number(e21) <
          Number(e50)
      ) {

        bear += 2;

        reasons.push(
          'EMA bearish'
        );
      }
    }


    // ========================================================
    // SUPERTREND
    // Weight: 2
    // ========================================================

    if (st === 1) {

      bull += 2;

      reasons.push(
        'Supertrend bullish'
      );

    } else if (
      st === -1
    ) {

      bear += 2;

      reasons.push(
        'Supertrend bearish'
      );
    }


    // ========================================================
    // ADX / DMI
    // Weight: 2
    //
    // ADX must be >= 20 before DMI contributes.
    // ========================================================

    if (
      [adx, plus, minus]
        .every(finite) &&
      Number(adx) >= 20
    ) {

      if (
        Number(plus) >
          Number(minus)
      ) {

        bull += 2;

        reasons.push(
          'ADX/DMI bullish'
        );

      } else if (
        Number(minus) >
          Number(plus)
      ) {

        bear += 2;

        reasons.push(
          'ADX/DMI bearish'
        );
      }
    }


    // ========================================================
    // RSI
    // Weight: 1
    // ========================================================

    if (finite(rsi)) {

      if (
        Number(rsi) >= 52
      ) {

        bull += 1;

        reasons.push(
          'RSI bullish'
        );

      } else if (
        Number(rsi) <= 48
      ) {

        bear += 1;

        reasons.push(
          'RSI bearish'
        );
      }
    }


    // ========================================================
    // MACD HISTOGRAM
    // Weight: 1
    // ========================================================

    if (finite(hist)) {

      if (
        Number(hist) > 0
      ) {

        bull += 1;

        reasons.push(
          'MACD positive'
        );

      } else if (
        Number(hist) < 0
      ) {

        bear += 1;

        reasons.push(
          'MACD negative'
        );
      }
    }


    // ========================================================
    // VWAP
    // Weight: 1
    // ========================================================

    if (
      finite(vwap) &&
      finite(close)
    ) {

      if (
        close >
          Number(vwap)
      ) {

        bull += 1;

        reasons.push(
          'Above VWAP'
        );

      } else if (
        close <
          Number(vwap)
      ) {

        bear += 1;

        reasons.push(
          'Below VWAP'
        );
      }
    }


    // ========================================================
    // NIFTY EDGE
    // Weight: 3
    //
    // IMPORTANT:
    // Only use the edge result belonging to this candle.
    // Never use the current/latest EDGE signal backward.
    // ========================================================

    const edgeRow =
      edge?.rows?.[i];


    if (
      edgeRow &&
      ['BUY', 'BUY+']
        .includes(
          edgeRow.signal
        )
    ) {

      bull += 3;

      reasons.push(
        'NIFTY EDGE buy'
      );

    } else if (
      edgeRow &&
      ['SELL', 'SELL+']
        .includes(
          edgeRow.signal
        )
    ) {

      bear += 3;

      reasons.push(
        'NIFTY EDGE sell'
      );
    }


    // ========================================================
    // SSL + QQE
    // Weight: 2
    //
    // Again use only the historical row at this candle.
    // ========================================================

    const gainzRow =
      gainz?.rows?.[i];


    if (
      gainzRow?.side === 1
    ) {

      bull += 2;

      reasons.push(
        'SSL+QQE long'
      );

    } else if (
      gainzRow?.side === -1
    ) {

      bear += 2;

      reasons.push(
        'SSL+QQE short'
      );
    }


    // ========================================================
    // DIRECTION
    // ========================================================

    const side =
      bull > bear
        ? 1
        : bear > bull
          ? -1
          : 0;


    const leader =
      Math.max(
        bull,
        bear
      );


    const gap =
      Math.abs(
        bull -
        bear
      );


    // ========================================================
    // FINAL CHART STATE
    // ========================================================

    let state =
      'NO TRADE';


    // STRONG BUY
    if (
      side === 1 &&
      leader >= 9 &&
      gap >= 5
    ) {

      state =
        'STRONG BUY';

    // STRONG SELL
    } else if (
      side === -1 &&
      leader >= 9 &&
      gap >= 5
    ) {

      state =
        'STRONG SELL';

    // BUY
    } else if (
      side === 1 &&
      leader >= 7 &&
      gap >= 3
    ) {

      state =
        'BUY';

    // SELL
    } else if (
      side === -1 &&
      leader >= 7 &&
      gap >= 3
    ) {

      state =
        'SELL';
    }


    const actionable =
      state !==
      'NO TRADE';


    // ========================================================
    // SIGNAL MARKER CONTROL
    // ========================================================
    //
    // state:
    //   describes every candle.
    //
    // signal:
    //   only creates a chart marker when appropriate.
    //
    // Same-side markers are not printed continuously.
    // A same-direction marker can be refreshed after 6 candles.
    // ========================================================

    let signal =
      null;


    if (
      actionable &&
      (
        side !==
          lastSignalSide ||
        i -
          lastSignalIndex >=
          6
      )
    ) {

      signal =
        state;

      lastSignalSide =
        side;

      lastSignalIndex =
        i;
    }


    // ========================================================
    // HISTORICAL ROW
    // ========================================================

    rows[i] = {

      time:
        candle.time,

      state,

      signal,

      side:
        actionable
          ? side
          : 0,

      bull,

      bear,

      score:
        leader,

      gap,

      reasons:
        reasons.slice(
          0,
          8
        )
    };
  }


  // ==========================================================
  // RESULT
  // ==========================================================

  return {

    rows,

    latest:
      rows[lastClosed] ||
      null
  };
}
