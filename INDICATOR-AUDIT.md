# SMRT Algo Pro NIFTY 50 indicator audit

Date: 15 October 2026. Baseline: `aedd61cb90b5c591388617e08c14f5adae3533c2`.
Scope: executable JavaScript and UI wiring in the repository; the bundled ZIP and Android binaries are not separate audited implementations. Presence is not proof of profitability or exact TradingView parity. Prior-chat assistant responses were unavailable placeholders.

| Requested indicator | Actual implementation and status |
| --- | --- |
| EMA 9/21/50/200 | `market.js: indicators`, chart overlays and Prime inputs in `app.js`. Present. Chart EMAs use a first-price seed; extended Keltner uses an SMA seed. Early values can differ from other platforms. |
| RSI | Wilder RSI(14) in `market.js`, plus advanced and Pro Suite variants; wired to momentum/Prime. Present. |
| MACD | 12/26/9 and histogram in `market.js`, wired to momentum/Prime. Present; inherits chart EMA seeding. |
| Bollinger Bands | SMA20 plus/minus 2 population standard deviations in `market.js`, chart/readout wiring. Present. |
| VWAP | Session VWAP in `market.js`; NIFTY confirmation uses verified completed futures VWAP via `closed-vwap-confirmation.js` and `nifty-futures-vwap.js`. Futures confirmation is a separate instrument, not cash-index volume. Unavailable data must remain unavailable. |
| Supertrend | `trend-indicators.js` and `pro-suite.js`, wired in `app.js`. Present, with documented initialization choices. |
| ADX/DMI | Wilder smoothing in `trend-indicators.js` and `pro-suite.js`; Prime inputs. Present. |
| ATR | Trend/Pro Suite outputs and Market Map volatility readout. Present. Keltner now explicitly uses Wilder ATR10. |
| Donchian | `donchian.js`, imported by `smrt-market-map.js`; prior-channel breakout comparison and Market Map display. Present. |
| Keltner | Extended Market Map readout. Fixed warm-up null coercion and replaced rolling SMA of true range with Wilder ATR10; EMA20 +/- 2 ATR10. |
| CPR/pivots | CPR existed in inline Market Map code. Added floor S1/S2/S3 and R1/R2/R3; CPR bounds are sorted. Require a complete previous session at the selected interval. Missing history displays WARMING UP. |
| Opening Range | Market Map 09:15–09:30 IST high/low. Fixed inclusion of 1h/daily bars; requires every completed 1m/3m/5m/15m opening bar. No approximation from larger bars. |
| CCI | `cci.js` and Market Map calculation. Reused tested CCI20 helper so a flat range produces zero consistently instead of WARMING UP. |
| MFI | Market Map MFI14, now in `extended-indicators.js`. Present but intentionally unavailable on NIFTY cash. Explicit trusted traded volume is required. No futures MFI is silently substituted. |
| CMF | Market Map CMF20. Fixed denominator to include flat-candle volume with zero flow; unavailable on NIFTY cash. |
| OBV | Market Map readout; zero baseline over supplied history. Fixed validation to cover all contributing volumes, not only the latest 20. Unavailable on NIFTY cash. |
| Aroon | Market Map Aroon25. Fixed to use current plus 25 previous bars, denominator 25, newest equal extrema. |
| Choppiness | Efficiency engine and Market Map CHOP14. Extended readout requires a previous close for all 14 true ranges. |
| BOS/CHoCH | `price-action.js`, `pro-suite.js`, and Prime structure in `app.js`. Present; confirmed swing rules, not a proprietary SMC port. |
| Order blocks | `price-action.js` and Prime structure in `app.js`; Prime requires displacement and tracks invalidation. Present as original OHLC heuristics. |
| FVG | Three-candle gaps in `price-action.js` and Prime; Prime additionally checks displacement and contiguous bars. Present; engine rules differ. |
| Liquidity sweeps | Pro Suite, Prime structure, `smrt-liquidity-trap.js`, and UI. Present as price-based sweep heuristics, not verified exchange order flow. |
| Supply/demand | Prime labels active demand/supply order-block zones and renders them. Present as OB-derived zones; no separate auction/order-book model. |
| RBVE [PhenLabs] | Absent. Original publication, author attribution, source revision, and applicable license could not be verified. Deliberately not implemented. |

## Changes and validation

- Fixed `closedForPremium` including the forming candle: it now uses `primeClosed`, and the latest completed candle is selected without an extra one-bar lag.
- Extracted inline extended calculations into `extended-indicators.js`, with strict OHLC/missing-value handling and numeric conversion before typical-price arithmetic.
- Added complete-session coverage checks, pivot readouts, and clearing of stale extended readouts when Market Map loses data.
- Advanced engine now rejects null/blank/nonfinite or inconsistent OHLC and returns WAIT for the batch instead of filtering away invalid bars and bridging their gaps.
- No changes to trade thresholds, automatic orders, or broker credentials. Extended readouts remain informational and do not add independent consensus votes.
- Baseline: 225 tests passed. After fixes: 234 tests passed (9 new regression tests); `node --check app.js` and `git diff --check` passed. Existing panel tests use the real newly imported helpers.
- Tests use deterministic fixtures and mocked feeds. This does not certify production prices, broker authentication, every duplicate indicator engine, visual rendering in a browser, or trading results. No live order or deployment was attempted.

## RBVE source and license gate

Searches covered the exact acronym, PhenLabs attribution, supplied settings and the candidate expanded name. A third-party mirror exposed a candidate named “Range Breakout Verdict Engine” with matching settings, but that does not establish PhenLabs authorship, authenticity, or reuse permission. Its code was not copied or ported. The PhenLabs library URL currently redirects to a coming-soon page, so it did not verify the candidate.

TradingView documents MPL 2.0 as the default for its open-source publications. That general rule does not establish that this particular indicator is an open-source publication or that the mirrored revision carries that license. Implementation requires the original author publication URL and original source/license header (or explicit permission), followed by attribution/license compliance and parity tests.

Primary references checked:

- PhenLabs library: https://phenlabs.com/library
- TradingView publishing/license documentation: https://www.tradingview.com/pine-script-docs/writing/publishing/
- Aroon: https://www.tradingview.com/support/solutions/43000501801-aroon-indicator/
- Keltner: https://www.tradingview.com/support/solutions/43000502266/
- CMF: https://www.tradingview.com/support/solutions/43000501974/

## Release status

Changes are prepared for review only. Production deployment has not been authorized for this concrete patch and no deployment has been performed. The repository contains Netlify publication settings and Cloudflare Worker/static asset settings; their existence does not verify active hosting or production revision. Do not merge or deploy solely because unit tests pass. Review the patch and check the intended hosting target and production configuration before release.

## Follow-up verification — 17 October 2026

- GitHub reports the Cloudflare preview build and preview deployment succeeded for f578fd8. This was automatic branch preview deployment; PR #105 remains unmerged. The earlier statement that no deployment existed did not account for the automatic preview.
- Browser inspection confirmed populated Keltner, floor pivots, CPR, CCI, Aroon and Choppiness readouts, with NIFTY cash MFI/CMF/OBV unavailable. No captured browser errors. Final confirmation and risk panels correctly showed MARKET CLOSED / NO TRADE.
- Found and fixed an additional Pro Scalper display inconsistency: old entry/stop/target levels were labelled live-session levels while NSE was closed. Closed sessions now hide those levels and show an explicit historical-context label; Replay levels are labelled historical. Historical chart markers are retained.
- Full regression suite after this fix: 237/237 passed, including three scalper session-display tests. Live market-hours feed and execution validation remain outstanding; no order was placed.
