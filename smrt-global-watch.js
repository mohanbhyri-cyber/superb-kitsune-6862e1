// smrt-global-watch.js
// ============================================================
// SMRT 24/7 GLOBAL WATCH
// Uses external global-market cues to estimate next-session bias.
// It does NOT claim NIFTY is tradable outside NSE market hours.
// ============================================================

const finite = value =>
  Number.isFinite(
    Number(value)
  );

export function analyseGlobalWatch(
  payload
) {

  const items =
    Array.isArray(
      payload?.items
    )
      ? payload.items
      : [];

  let score = 0;
  let maxScore = 0;

  const reasons = [];

  const rows =
    items.map(
      item => {

        const change =
          Number(
            item.changePercent
          );

        const momentum =
          Number(
            item.momentum
          );

        let side = 0;
        let weight = 1;

        if (
          item.role ===
          'risk'
        ) {
          weight =
            item.key.includes(
              'futures'
            )
              ? 3
              : 2;

          if (
            finite(change)
          ) {
            if (change > 0.12) {
              side = 1;
            } else if (
              change < -0.12
            ) {
              side = -1;
            }
          }

          if (
            side === 0 &&
            finite(momentum)
          ) {
            if (
              momentum > 0.08
            ) {
              side = 1;
            } else if (
              momentum < -0.08
            ) {
              side = -1;
            }
          }

        } else if (
          item.role ===
          'inverse'
        ) {
          weight = 2;

          if (
            finite(change)
          ) {
            if (change > 1) {
              side = -1;
            } else if (
              change < -1
            ) {
              side = 1;
            }
          }

        } else if (
          item.role ===
          'inverse_small'
        ) {
          weight = 1;

          if (
            finite(change)
          ) {
            if (change > 0.18) {
              side = -1;
            } else if (
              change < -0.18
            ) {
              side = 1;
            }
          }
        }

        maxScore += weight;

        score +=
          side * weight;

        if (side !== 0) {
          reasons.push(
            item.name +
            ' ' +
            (
              side === 1
                ? 'supports bullish bias'
                : 'supports bearish bias'
            )
          );
        }

        return {
          ...item,
          side,
          weight
        };
      }
    );

  const confidence =
    maxScore > 0
      ? Math.round(
          Math.abs(score) /
          maxScore *
          100
        )
      : 0;

  let bias =
    'NEUTRAL';

  if (
    score >= 4
  ) {
    bias =
      confidence >= 60
        ? 'BULLISH'
        : 'LEAN BULLISH';
  } else if (
    score <= -4
  ) {
    bias =
      confidence >= 60
        ? 'BEARISH'
        : 'LEAN BEARISH';
  }

  return {
    bias,
    score,
    confidence,
    rows,
    reasons:
      reasons.slice(
        0,
        6
      ),
    sourceCount:
      rows.length,
    updated:
      Date.now()
  };
}
