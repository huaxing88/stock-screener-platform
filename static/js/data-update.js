// ─── 数据更新 + 进度轮询 ──────────────────────────────────────────────

let _updatePollTimer = null;

async function loadDataStatus() {
  try {
    const resp = await fetch('/api/data/status');
    const data = await resp.json();
    const label = document.getElementById('data-status-label');
    const verifyTag = document.getElementById('data-verify-tag');
    const isMock = data.akshare_available === false;
    const isUnknown = data.akshare_available === null || data.akshare_available === undefined;
    if (isMock) {
      label.textContent = '模拟数据 (无网络连接)';
      label.style.color = 'var(--orange-accent)';
      verifyTag.textContent = '校验: 模拟数据';
      verifyTag.style.color = 'var(--orange-accent)';
      verifyTag.style.borderColor = 'rgba(255,159,10,0.35)';
    } else if (data.cached_stocks > 0) {
      const end = data.data_end || '?';
      const src = isUnknown ? '' : ' (真实数据)';
      const coverage = data.coverage_pct ?? 0;
      const freshness = data.freshness_pct ?? 0;
      const gap = data.gap_stocks ?? 0;
      const short = data.short_stocks ?? 0;
      const refillNeed = data.refill_required_stocks ?? 0;
      label.textContent = `${data.cached_stocks}/${data.total_stocks} 已缓存${src}, 最新: ${end}, 回填待处理: ${refillNeed}`;
      label.style.color = 'var(--text-tertiary)';

      const p1 = data.refill_priority?.p1_delta ?? 0;
      const p2 = data.refill_priority?.p2_gap ?? 0;
      const p3 = data.refill_priority?.p3_history ?? 0;
      verifyTag.textContent = `校验: 覆盖 ${coverage}% | 最新 ${freshness}% | 断档 ${gap} | 长度不足 ${short} | P1:${p1} P2:${p2} P3:${p3}`;

      if ((data.missing_stocks ?? 0) === 0 && (data.stale_stocks ?? 0) === 0 && gap === 0 && short === 0) {
        verifyTag.style.color = 'var(--green-accent)';
        verifyTag.style.borderColor = 'rgba(48,209,88,0.35)';
      } else {
        verifyTag.style.color = 'var(--orange-accent)';
        verifyTag.style.borderColor = 'rgba(255,159,10,0.35)';
      }
    } else {
      label.textContent = '暂无数据 — 请点击更新';
      label.style.color = 'var(--text-tertiary)';
      verifyTag.textContent = '校验: 未建立缓存';
      verifyTag.style.color = 'var(--text-tertiary)';
      verifyTag.style.borderColor = 'var(--glass-border)';
    }
  } catch(e) { console.warn('Failed to load data status:', e); }
}

async function startDataUpdate() {
  const dialog = document.getElementById('update-dialog');
  const log = document.getElementById('update-log');
  const bar = document.getElementById('update-progress-bar');
  const statusText = document.getElementById('update-status-text');
  const progressText = document.getElementById('update-progress-text');
  const currentStock = document.getElementById('update-current-stock');
  const closeBtn = document.getElementById('btn-close-update');
  const resultMsg = document.getElementById('update-result-msg');
  const updateBtn = document.getElementById('btn-update-data');
  const updateMode = document.getElementById('update-mode').value || 'incremental';
  const updateMarketFilter = document.getElementById('update-market-filter').value || null;
  const maxWorkers = parseInt(document.getElementById('update-workers').value || '8', 10);

  log.innerHTML = '';
  bar.style.width = '0%';
  bar.style.background = 'var(--orange-accent)';
  statusText.textContent = '准备中...';
  progressText.textContent = '0 / 0';
  currentStock.textContent = '--';
  closeBtn.classList.add('hidden');
  resultMsg.textContent = '';
  updateBtn.disabled = true;
  updateBtn.classList.add('opacity-50');
  dialog.classList.remove('hidden');

  try {
    const resp = await fetch('/api/data/update', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        market_filter: updateMarketFilter,
        update_mode: updateMode,
        max_workers: maxWorkers,
      }),
    });
    const data = await resp.json();
    if (!data.success) {
      statusText.textContent = data.message;
      closeBtn.classList.remove('hidden');
      updateBtn.disabled = false;
      updateBtn.classList.remove('opacity-50');
      return;
    }
    const modeLabel = updateMode === 'full' ? '全量刷新' : '智能补齐';
    const marketLabel = updateMarketFilter || '全部市场';
    addUpdateLog(`启动参数: ${modeLabel} | ${marketLabel} | 并发 ${maxWorkers}`, 'text-gray-400');
  } catch(e) {
    statusText.textContent = '启动失败: ' + e.message;
    closeBtn.classList.remove('hidden');
    updateBtn.disabled = false;
    updateBtn.classList.remove('opacity-50');
    return;
  }

  let lastLogLen = 0;
  _updatePollTimer = setInterval(async () => {
    try {
      const resp = await fetch('/api/data/progress');
      const d = await resp.json();

      if (d.total > 0) {
        const pct = Math.round(d.current / d.total * 100);
        bar.style.width = pct + '%';
        progressText.textContent = `${d.current} / ${d.total}`;
        statusText.textContent = d.status === 'running' ? `更新中... ${pct}%` : d.status;
        currentStock.textContent = d.code ? `${d.code} ${d.name}` : '';
      } else if (d.status === 'running' && d.message) {
        statusText.textContent = d.message;
      }

      if (d.log && d.log.length > lastLogLen) {
        for (let i = lastLogLen; i < d.log.length; i++) {
          const isErr = d.log[i].includes('Error') || d.log[i].includes('错误') || d.log[i].includes('失败');
          addUpdateLog(d.log[i], isErr ? 'text-red-400' : 'text-gray-400');
        }
        lastLogLen = d.log.length;
      }

      if (d.status === 'completed') {
        clearInterval(_updatePollTimer);
        bar.style.width = '100%';
        bar.style.background = 'var(--green-accent)';
        statusText.textContent = '更新完成';
        resultMsg.textContent = d.message;
        addUpdateLog(d.message, 'text-green-400');
        closeBtn.classList.remove('hidden');
        updateBtn.disabled = false;
        updateBtn.classList.remove('opacity-50');
        loadDataStatus();
      } else if (d.status === 'error') {
        clearInterval(_updatePollTimer);
        bar.style.background = 'var(--red-accent)';
        statusText.textContent = '更新出错';
        resultMsg.textContent = d.message;
        addUpdateLog(d.message, 'text-red-400');
        closeBtn.classList.remove('hidden');
        updateBtn.disabled = false;
        updateBtn.classList.remove('opacity-50');
      } else if (d.status === 'idle') {
        clearInterval(_updatePollTimer);
        closeBtn.classList.remove('hidden');
        updateBtn.disabled = false;
        updateBtn.classList.remove('opacity-50');
        loadDataStatus();
      }
    } catch(e) {
      // 忽略瞬态轮询错误
    }
  }, 500);
}

function addUpdateLog(msg, colorClass) {
  const log = document.getElementById('update-log');
  const div = document.createElement('div');
  div.className = colorClass || 'text-gray-400';
  div.textContent = msg;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function closeUpdateDialog() {
  document.getElementById('update-dialog').classList.add('hidden');
  if (_updatePollTimer) clearInterval(_updatePollTimer);
  document.getElementById('update-progress-bar').style.background = 'var(--orange-accent)';
}
