// ─── 选股 + 进度轮询 ──────────────────────────────────────────────────

let _screenPollTimer = null;

async function screenStocks() {
  const formula = document.getElementById('formula-editor').value.trim();
  if (!formula) { showMsg('请输入公式', 'red'); return; }

  screenDate = document.getElementById('screen-date').value.replace(/-/g, '');
  const excludeSt = document.getElementById('exclude-st').checked;
  const marketFilter = document.getElementById('market-filter').value || null;

  const isFirstRun = localStorage.getItem(SCREEN_WARMUP_KEY) !== '1';
  const loadingTitle = isFirstRun ? '第一次选股，先热热身，股神别急' : '自愿帮股神干活中...';
  _screenLoadingBaseTitle = loadingTitle;
  showLoading(true, loadingTitle, '准备中', true);
  localStorage.setItem(SCREEN_WARMUP_KEY, '1');

  try {
    const resp = await fetch('/api/screen', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        formula,
        formula_type: currentFormulaType,
        date: screenDate,
        exclude_st: excludeSt,
        market_filter: marketFilter,
      }),
    });
    const data = await resp.json();

    if (data.async) {
      _screenPollTimer = setInterval(pollScreenProgress, 400);
    } else if (data.success) {
      showLoading(false);
      handleScreenResult(data);
    } else {
      showLoading(false);
      showMsg(data.message, 'red');
      document.getElementById('result-count').textContent = '选股失败';
    }
  } catch(e) {
    showLoading(false);
    showMsg('请求失败: ' + e.message, 'red');
  }
}

async function pollScreenProgress() {
  try {
    const resp = await fetch('/api/screen/progress');
    const d = await resp.json();

    if (d.total > 0) {
      const pct = Math.round(d.current / d.total * 100);
      document.getElementById('loading-text').textContent = `${_screenLoadingBaseTitle} ${pct}%`;
      document.getElementById('loading-sub').textContent = d.message || '';
      document.getElementById('loading-progress-bar').style.width = pct + '%';
      document.getElementById('loading-progress-detail').textContent = `${d.current} / ${d.total}`;
      document.getElementById('loading-progress-matched').textContent = `匹配 ${d.matched || 0} 只`;
    }

    if (d.status === 'completed' && d.data) {
      clearInterval(_screenPollTimer);
      showLoading(false);
      handleScreenResult(d.data);
    } else if (d.status === 'canceled') {
      clearInterval(_screenPollTimer);
      showLoading(false);
      if (d.data) handleScreenResult(d.data);
      showMsg(d.message || '已取消选股', 'gray');
    } else if (d.status === 'error') {
      clearInterval(_screenPollTimer);
      showLoading(false);
      showMsg(d.message, 'red');
      document.getElementById('result-count').textContent = '选股失败';
    }
  } catch(e) {
    // 忽略瞬态轮询错误
  }
}

function handleScreenResult(data) {
  if (data.success) {
    screenResults = (data.results || []).map((r, i) => ({ ...r, _origin_idx: i }));
    screenResultsView = [...screenResults];
    _returnSortState = { key: null, order: 'default' };
    updateSortButtonLabels();

    renderResultsTable(screenResultsView);
    renderStatistics(data.stats, data.total_matched, data.total_screened);
    renderHistogram();
    document.getElementById('btn-export').classList.toggle('hidden', screenResultsView.length === 0);
    if (screenResultsView.length > 0) {
      loadKline(screenResultsView[0].code, screenResultsView[0].name);
    }
  } else {
    showMsg(data.message, 'red');
    document.getElementById('result-count').textContent = '选股失败';
  }
}
