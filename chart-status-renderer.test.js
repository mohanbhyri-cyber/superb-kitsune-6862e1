import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncChartStatusRows } from './chart-status-renderer.js';

function fixture() {
  const counts = { nodes: 0, fragments: 0, replacements: 0, writes: 0 };
  function node(tagName) {
    counts.nodes++;
    let text = '', className = '', title = '';
    return { tagName: tagName.toUpperCase(), children: [], scrollTop: 0,
      get childNodes() { return this.children; },
      get textContent() { return this.children.length ? this.children.map(x => x.textContent).join('') : text; },
      set textContent(value) { counts.writes++; text = value; this.children = []; },
      get className() { return className; },
      set className(value) { counts.writes++; className = value; },
      get title() { return title; },
      set title(value) { counts.writes++; title = value; },
      set innerHTML(_value) { throw new Error('Must use text-only rendering'); },
      append(...children) { this.children.push(...children); },
      replaceChildren(fragment) {
        counts.replacements++; this.children = [...fragment.children]; this.scrollTop = 0;
      }
    };
  }
  const document = { createElement: node,
    createDocumentFragment() { counts.fragments++; return node('fragment'); } };
  const panel = node('div');
  const render = rows => syncChartStatusRows(panel, rows, document);
  const values = () => panel.children.map(row => ({ name: row.children[0].textContent,
    value: row.children[1].textContent, tone: row.children[1].className,
    title: row.title, rowClass: row.className }));
  return { counts, document, panel, render, values };
}
const rows = () => [
  { name: 'Market Map', value: 'WAIT' },
  { name: 'SMRT Trigger', value: 'BULLISH · 73/100', tone: 'up', title: 'Directional evidence only' },
  { name: 'Risk Engine', value: 'MARKET CLOSED', risk: true }
];

test('100 identical status renders allocate and replace the row subtree only once', () => {
  const f = fixture(); f.render(rows());
  const initial = { ...f.counts }, nodes = [...f.panel.children];
  for (let i = 0; i < 99; i++) f.render(rows());
  assert.deepEqual(f.counts, initial);
  assert.equal(f.counts.replacements, 1);
  assert.deepEqual(f.panel.children, nodes);
});

test('a changed value updates immediately without replacing rows or losing panel scroll', () => {
  const f = fixture(), model = rows(); f.render(model);
  const initial = { ...f.counts }, row = f.panel.children[1];
  f.panel.scrollTop = 120;
  model[1].value = 'BULLISH · 74/100'; f.render(model);
  assert.equal(f.counts.writes, initial.writes + 1);
  assert.equal(f.counts.nodes, initial.nodes);
  assert.equal(f.counts.replacements, initial.replacements);
  assert.equal(f.panel.children[1], row);
  assert.equal(f.panel.scrollTop, 120);
  assert.equal(f.values()[1].value, 'BULLISH · 74/100');
});

test('direction, risk styling, labels and tooltip removals never remain stale', () => {
  const f = fixture(), model = rows(); f.render(model);
  model[1] = { name: 'New context', value: 'BEARISH', tone: 'down', risk: true };
  f.render(model);
  assert.deepEqual(f.values()[1], { name: 'New context', value: 'BEARISH', tone: 'down',
    title: '', rowClass: 'chart-status-row chart-risk-row' });
  model[1] = { name: 'New context', value: 'WAIT' }; f.render(model);
  assert.equal(f.values()[1].tone, 'muted');
  assert.equal(f.values()[1].rowClass, 'chart-status-row');
});

test('adding and removing rows rebuilds a complete correct list rather than leaving old rows', () => {
  const f = fixture(), model = rows(); f.render(model);
  model.push({ name: 'Extra vote', value: 'BEARISH', tone: 'down' }); f.render(model);
  assert.equal(f.panel.children.length, 4);
  model.splice(1, 2); f.render(model);
  assert.deepEqual(f.values().map(x => x.name), ['Market Map', 'Extra vote']);
  f.render([]); assert.equal(f.panel.children.length, 0);
});

test('external text edits are repaired from actual DOM state, not a cached signature', () => {
  const f = fixture(); f.render(rows());
  f.panel.children[0].children[1].textContent = 'FORCED BUY';
  f.render(rows()); assert.equal(f.values()[0].value, 'WAIT');
  assert.equal(f.counts.replacements, 1);
});

test('malformed or externally nested row nodes are replaced safely', () => {
  const f = fixture(); f.render(rows());
  f.panel.children[0].children[1].append(f.document.createElement('em'));
  f.render(rows());
  assert.equal(f.counts.replacements, 2);
  assert.equal(f.panel.children[0].children[1].children.length, 0);
  assert.equal(f.values()[0].value, 'WAIT');
});

test('HTML-like names and reasons stay literal text and inputs remain unchanged', () => {
  const f = fixture();
  const model = [{ name: '<img src=x onerror=alert(1)>', value: '<script>bad</script>',
    title: '<b>reason</b>' }];
  const original = structuredClone(model);
  f.render(model); f.render(model);
  assert.equal(f.values()[0].name, original[0].name);
  assert.equal(f.values()[0].value, original[0].value);
  assert.deepEqual(model, original);
});

test('stray non-row DOM nodes trigger repair instead of hiding a changed status', () => {
  const f = fixture(); f.render(rows());
  Object.defineProperty(f.panel, 'childNodes', { configurable: true,
    get() { return [...this.children, { nodeType: 3 }]; } });
  f.render(rows()); assert.equal(f.counts.replacements, 2);
  assert.deepEqual(f.values().map(x => x.value), rows().map(x => x.value));
});
