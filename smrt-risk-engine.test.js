import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseRisk } from './smrt-risk-engine.js';

const long = { entry: 100, stopLoss: 90, target1: 115, target2: 120, target3: 130 };
const short = { entry: 100, stopLoss: 110, target1: 85, target2: 80, target3: 70 };
const options = side => ({ side, atr: 10 });

test('risk accepts valid ordered long and short targets with directional rewards', () => {
  for (const [plan, side] of [[long, 1], [short, -1]]) {
    const result = analyseRisk(plan, options(side));
    assert.equal(result.quality, 'GOOD');
    assert.equal(result.score, 100);
    assert.deepEqual([result.rr1, result.rr2, result.rr3], [1.5, 2, 3]);
  }
  assert.equal(analyseRisk({ ...long, stopLoss: undefined, stop: '90' }, options(1)).quality, 'GOOD');
});

test('risk blocks missing, nonnumeric, nonpositive or malformed levels including later targets', () => {
  for (const key of ['entry', 'stopLoss', 'target1', 'target2', 'target3']) {
    for (const value of [undefined, null, '', ' ', false, true, [], NaN, Infinity, 'bad', 0, -1]) {
      const result = analyseRisk({ ...long, [key]: value }, options(1));
      assert.equal(result.quality, 'BLOCK', key + ': ' + String(value));
      assert.equal(result.score, 0);
    }
  }
});

test('risk blocks opposite, duplicate and unordered targets on both sides', () => {
  for (const [plan, side] of [[long, 1], [short, -1]]) {
    for (const change of [
      { target2: plan.stopLoss }, { target3: plan.stopLoss },
      { target1: plan.entry }, { target2: plan.target1 }, { target3: plan.target2 },
      { target2: plan.target3, target3: plan.target2 }, { stopLoss: plan.target1 }
    ]) {
      const result = analyseRisk({ ...plan, ...change }, options(side));
      assert.equal(result.quality, 'BLOCK');
      assert.equal(result.score, 0);
    }
  }
  const regression = analyseRisk({ ...long, target2: 80, target3: 90 }, options(1));
  assert.equal(regression.quality, 'BLOCK');
  assert.ok(regression.rr2 < 0);
});

test('risk preserves no-plan, stale-data, unknown-side and weak-reward checks', () => {
  assert.equal(analyseRisk(null, options(1)).state, 'NO ACTIVE PLAN');
  assert.equal(analyseRisk(long, { ...options(1), contextFresh: false }).quality, 'BLOCK');
  assert.equal(analyseRisk(long, options(0)).quality, 'BLOCK');
  assert.notEqual(analyseRisk({ ...long, target1: 109 }, options(1)).quality, 'GOOD');
});
