// ─── 结果表格 + 排序 + 统计 + 导出 ────────────────────────────────────

function renderResultsTable(results) {
  const tbody = document.getElementById('results-body');
  document.getElementById('result-count').textContent =
    `共 ${results.length} 只匹配`;

  if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-12 text-gray-500">未找到匹配的股票</td></tr>';
    return;
  }

  tbody.innerHTML = results.map((r, i) => `
    <tr class="result-row cursor-pointer transition-colors" onclick="loadKline('${r.code}', '${r.name}')">
      <td class="px-3 py-2 text-gray-500">${i + 1}</td>
      <td class="px-3 py-2 font-mono text-blue-400">${r.code}</td>
      <td class="px-3 py-2 text-gray-200">${r.name}</td>
      <td class="px-3 py-2 text-right text-gray-300">${r.date_price.toFixed(2)}</td>
      <td class="px-3 py-2 text-right ${pctClass(r.return_3d)}">${fmtPct(r.return_3d)}</td>
      <td class="px-3 py-2 text-right ${pctClass(r.return_5d)}">${fmtPct(r.return_5d)}</td>
      <td class="px-3 py-2 text-right ${pctClass(r.return_10d)}">${fmtPct(r.return_10d)}</td>
      <td class="px-3 py-2 text-right ${pctClass(r.return_max15d)}">${fmtPct(r.return_max15d)}</td>
    </tr>
  `).join('');
}

function toggleReturnSort(metricKey) {
  if (_returnSortState.key !== metricKey) {
    _returnSortState = { key: metricKey, order: 'desc' };
  } else if (_returnSortState.order === 'desc') {
    _returnSortState = { key: metricKey, order: 'asc' };
  } else if (_returnSortState.order === 'asc') {
    _returnSortState = { key: null, order: 'default' };
  } else {
    _returnSortState = { key: metricKey, order: 'desc' };
  }
  applyReturnSort();
}

function applyReturnSort() {
  if (_returnSortState.order === 'default' || !_returnSortState.key) {
    screenResultsView = [...screenResults].sort((a, b) => (a._origin_idx ?? 0) - (b._origin_idx ?? 0));
  } else {
    const key = _returnSortState.key;
    const dir = _returnSortState.order === 'desc' ? -1 : 1;
    screenResultsView = [...screenResults].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const an = av === null || av === undefined;
      const bn = bv === null || bv === undefined;
      if (an && bn) return (a._origin_idx ?? 0) - (b._origin_idx ?? 0);
      if (an) return 1;
      if (bn) return -1;
      if (av === bv) return (a._origin_idx ?? 0) - (b._origin_idx ?? 0);
      return av > bv ? dir : -dir;
    });
  }
  updateSortButtonLabels();
  renderResultsTable(screenResultsView);
}

function updateSortButtonLabels() {
  const keys = ['return_3d', 'return_5d', 'return_10d', 'return_max15d'];
  keys.forEach((k) => {
    const btn = document.getElementById(`sort-btn-${k}`);
    if (!btn) return;
    if (_returnSortState.key === k) {
      btn.textContent = _returnSortState.order === 'desc' ? '↓' : (_returnSortState.order === 'asc' ? '↑' : '↕');
      btn.style.color = 'var(--text-primary)';
    } else {
      btn.textContent = '↕';
      btn.style.color = 'var(--text-tertiary)';
    }
  });
}

function renderStatistics(stats, matched, screened) {
  const panel = document.getElementById('stats-panel');
  panel.classList.remove('hidden');

  [
    { tag: '3d', avgId: 'stat-avg-3d', wrId: 'stat-wr-3d' },
    { tag: '5d', avgId: 'stat-avg-5d', wrId: 'stat-wr-5d' },
    { tag: '10d', avgId: 'stat-avg-10d', wrId: 'stat-wr-10d' },
    { tag: 'max15d', avgId: 'stat-avg-max15d', wrId: 'stat-wr-max15d' },
  ].forEach(({ tag, avgId, wrId }) => {
    const avg = stats[`avg_${tag}`];
    const wr = stats[`win_rate_${tag}`];
    const avgEl = document.getElementById(avgId);
    const wrEl = document.getElementById(wrId);

    if (avg !== null && avg !== undefined) {
      avgEl.textContent = (avg > 0 ? '+' : '') + avg.toFixed(2) + '%';
      avgEl.className = 'text-lg font-bold ' + (avg > 0 ? 'text-up' : avg < 0 ? 'text-down' : 'text-gray-300');
    } else {
      avgEl.textContent = '-';
      avgEl.className = 'text-lg font-bold text-gray-500';
    }

    if (wr !== null && wr !== undefined) {
      wrEl.textContent = `胜率 ${wr.toFixed(1)}%`;
      wrEl.className = 'text-sm ' + (wr >= 50 ? 'text-up' : 'text-down');
    } else {
      wrEl.textContent = '胜率 -';
      wrEl.className = 'text-sm text-gray-400';
    }
  });
}

function exportCSV() {
  if (screenResultsView.length === 0) return;
  const header = '代码,名称,当日价格,3日涨幅%,5日涨幅%,10日涨幅%,15日内最高涨幅%\n';
  const rows = screenResultsView.map(r =>
    `${r.code},${r.name},${r.date_price},${r.return_3d ?? ''},${r.return_5d ?? ''},${r.return_10d ?? ''},${r.return_max15d ?? ''}`
  ).join('\n');
  const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `screen_${screenDate}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
