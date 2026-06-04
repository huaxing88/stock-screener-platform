// ─── K 线图 + 收益分布直方图 ────────────────────────────────────────────

async function loadKline(code, name) {
  document.getElementById('kline-title').textContent = `${code} ${name}`;

  if (typeof echarts === 'undefined') {
    document.getElementById('kline-container').innerHTML =
      '<div class="flex items-center justify-center h-full text-sm" style="color:var(--text-tertiary);">ECharts 库加载失败，请刷新页面</div>';
    return;
  }

  try {
    const resp = await fetch(`/api/kline/${code}?center_date=${screenDate}&days_before=60&days_after=30`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderKlineChart(data);
    document.getElementById('kline-subtitle').textContent = `选股日: ${data.screen_date}`;
  } catch(e) {
    console.error('Failed to load K-line:', e);
    document.getElementById('kline-container').innerHTML =
      '<div class="flex items-center justify-center h-full text-sm" style="color:var(--text-tertiary);">K线数据加载失败: ' + e.message + '</div>';
  }
}

function renderKlineChart(data) {
  const container = document.getElementById('kline-container');
  if (!klineChart && container.firstChild && container.firstChild.tagName === 'DIV') {
    container.innerHTML = '';
  }
  if (!klineChart) {
    klineChart = echarts.init(container, 'dark');
  }

  const code = data.code || '';
  const limitPct = (code.startsWith('300') || code.startsWith('688')) ? 19.8 : 9.8;

  const isLimitUp = data.dates.map((_, i) => {
    const pct = data.pct_change && data.pct_change[i] != null ? data.pct_change[i] : null;
    return pct !== null && pct >= limitPct;
  });

  const candleData = data.dates.map((_, i) => {
    const item = { value: [data.open[i], data.close[i], data.low[i], data.high[i]] };
    if (isLimitUp[i]) {
      item.itemStyle = { color: '#FFD60A', borderColor: '#FFD60A' };
    }
    return item;
  });

  const volumeData = data.volume.map((v, i) => ({
    value: v,
    itemStyle: {
      color: isLimitUp[i] ? 'rgba(255,214,10,0.7)' :
             (data.close[i] >= data.open[i] ? '#ef4444' : '#22c55e')
    },
  }));

  function fmtAmount(val) {
    if (val == null) return '-';
    if (val >= 1e8) return (val / 1e8).toFixed(2) + '亿';
    if (val >= 1e4) return (val / 1e4).toFixed(1) + '万';
    return val.toFixed(0);
  }

  const option = {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        lineStyle: { color: 'rgba(255,255,255,0.2)', width: 0.5 },
        crossStyle: { color: 'rgba(255,255,255,0.2)', width: 0.5 },
      },
      backgroundColor: 'rgba(28,28,30,0.92)',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#f5f5f7', fontSize: 12 },
      formatter: function(params) {
        if (!params || params.length === 0) return '';
        const idx = params[0].dataIndex;
        const dateStr = data.dates[idx];
        const pct = data.pct_change && data.pct_change[idx] != null
          ? data.pct_change[idx] : null;
        const amt = data.amount && data.amount[idx] != null
          ? data.amount[idx] : null;
        const close = data.close[idx];

        let pctStr = '-';
        let pctColor = '#f5f5f7';
        if (pct !== null) {
          pctStr = (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
          pctColor = pct > 0 ? '#FF453A' : pct < 0 ? '#30D158' : '#f5f5f7';
        }

        const limitTag = isLimitUp[idx]
          ? ' <span style="color:#FFD60A;font-size:10px;">涨停</span>' : '';

        return `<div style="font-size:11px;line-height:1.8;">` +
          `<div style="color:rgba(245,245,247,0.5);">${dateStr}</div>` +
          `<div>收盘 <b>${close != null ? close.toFixed(2) : '-'}</b></div>` +
          `<div>涨幅 <span style="color:${pctColor};font-weight:600;">${pctStr}</span>${limitTag}</div>` +
          `<div>成交额 ${fmtAmount(amt)}</div>` +
          `</div>`;
      },
    },
    legend: {
      data: ['MA5', 'MA10', 'MA20'],
      top: 5, left: 10,
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 15, itemHeight: 2,
    },
    grid: [
      { left: '8%', right: '3%', top: '8%', height: '55%' },
      { left: '8%', right: '3%', top: '70%', height: '20%' },
    ],
    xAxis: [
      {
        type: 'category', data: data.dates, gridIndex: 0,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { show: false },
        axisTick: { show: false },
      },
      {
        type: 'category', data: data.dates, gridIndex: 1,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { show: false },
        splitLine: { show: false },
        axisTick: { show: false },
      },
    ],
    yAxis: [
      {
        scale: true, gridIndex: 0,
        axisLine: { show: false },
        axisLabel: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      {
        scale: true, gridIndex: 1,
        axisLine: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 20, end: 100 },
    ],
    series: [
      {
        name: 'K线', type: 'candlestick', data: candleData,
        itemStyle: {
          color: '#ef4444', color0: '#22c55e',
          borderColor: '#ef4444', borderColor0: '#22c55e',
        },
        markLine: {
          symbol: 'none',
          data: [{ xAxis: data.screen_date }],
          lineStyle: { color: 'rgba(245, 158, 11, 0.25)', width: 0.5, type: 'dashed' },
          label: { formatter: '选股日', color: 'rgba(245, 158, 11, 0.5)', fontSize: 9, distance: 8 },
        },
      },
      {
        name: 'MA5', type: 'line', data: data.ma5,
        smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#f59e0b' },
      },
      {
        name: 'MA10', type: 'line', data: data.ma10,
        smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#3b82f6' },
      },
      {
        name: 'MA20', type: 'line', data: data.ma20,
        smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#a855f7' },
      },
      {
        name: 'Volume', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
        data: volumeData,
      },
    ],
  };

  klineChart.setOption(option, true);
  setTimeout(() => { if (klineChart) klineChart.resize(); }, 50);
}

function renderHistogram() {
  if (screenResults.length === 0) return;

  const container = document.getElementById('histogram-container');
  if (!histogramChart) {
    histogramChart = echarts.init(container, 'dark');
  }

  const field = document.getElementById('hist-horizon').value;
  const values = screenResults.map(r => r[field]).filter(v => v !== null && v !== undefined);

  if (values.length === 0) {
    histogramChart.clear();
    return;
  }

  const binSize = 2;
  const minVal = Math.floor(Math.min(...values) / binSize) * binSize;
  const maxVal = Math.ceil(Math.max(...values) / binSize) * binSize;
  const bins = [];
  const counts = [];

  for (let b = minVal; b <= maxVal; b += binSize) {
    bins.push(`${b}~${b + binSize}%`);
    const count = values.filter(v => v >= b && v < b + binSize).length;
    counts.push({ value: count, itemStyle: { color: b >= 0 ? '#ef4444' : '#22c55e' } });
  }

  const option = {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(15,23,42,0.95)', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 } },
    grid: { left: '10%', right: '5%', top: '10%', bottom: '20%' },
    xAxis: {
      type: 'category', data: bins,
      axisLabel: { color: '#64748b', fontSize: 9, rotate: 45 },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 10 },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    series: [{ type: 'bar', data: counts, barMaxWidth: 30 }],
  };

  histogramChart.setOption(option, true);
  setTimeout(() => { if (histogramChart) histogramChart.resize(); }, 50);
}
