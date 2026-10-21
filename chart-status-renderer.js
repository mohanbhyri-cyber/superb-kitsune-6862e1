// Display-only reconciliation. No market requests or analysis are performed.
export function syncChartStatusRows(panel, rows, document) {
  const elements = Array.from(panel.children);
  const reusable = elements.length === rows.length &&
    (!panel.childNodes || panel.childNodes.length === elements.length) &&
    elements.every(row => String(row.tagName).toLowerCase() === 'div' &&
      row.children.length === 2 &&
      String(row.children[0].tagName).toLowerCase() === 'span' &&
      String(row.children[1].tagName).toLowerCase() === 'strong' &&
      row.children[0].children.length === 0 && row.children[1].children.length === 0);
  const fragment = reusable ? null : document.createDocumentFragment();
  rows.forEach((item, index) => {
    const row = reusable ? elements[index] : document.createElement('div');
    const label = reusable ? row.children[0] : document.createElement('span');
    const value = reusable ? row.children[1] : document.createElement('strong');
    const rowClass = 'chart-status-row' + (item.risk ? ' chart-risk-row' : '');
    const name = String(item.name ?? '');
    const text = String(item.value ?? '');
    const tone = item.tone || 'muted';
    const title = item.title || '';
    if (row.className !== rowClass) row.className = rowClass;
    if (label.textContent !== name) label.textContent = name;
    if (value.textContent !== text) value.textContent = text;
    if (value.className !== tone) value.className = tone;
    if ((row.title || '') !== title) row.title = title;
    if (!reusable) {
      row.append(label, value);
      fragment.append(row);
    }
  });
  if (!reusable) panel.replaceChildren(fragment);
}
