// ─── 工具函数 ──────────────────────────────────────────────────────────

function fmtPct(val) {
  if (val === null || val === undefined) return '-';
  return (val > 0 ? '+' : '') + val.toFixed(2) + '%';
}

function pctClass(val) {
  if (val === null || val === undefined) return 'text-gray-500';
  return val > 0 ? 'text-up' : val < 0 ? 'text-down' : 'text-gray-300';
}

function showMsg(text, color) {
  const el = document.getElementById('validate-msg');
  el.textContent = text;
  el.className = 'text-sm ' + (color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-gray-400');
  setTimeout(() => { el.textContent = ''; }, 5000);
}

function showLoading(show, title, sub, showProgress) {
  const overlay = document.getElementById('loading-overlay');
  const progressWrap = document.getElementById('loading-progress-wrap');
  const cancelBtn = document.getElementById('loading-cancel-btn');
  if (show) {
    document.getElementById('loading-text').textContent = title || '处理中...';
    document.getElementById('loading-sub').textContent = sub || '';
    cancelBtn.disabled = false;
    cancelBtn.style.opacity = '1';
    cancelBtn.title = '取消选股';
    if (showProgress) {
      progressWrap.classList.remove('hidden');
      document.getElementById('loading-progress-bar').style.width = '0%';
      document.getElementById('loading-progress-detail').textContent = '0 / 0';
      document.getElementById('loading-progress-matched').textContent = '匹配 0 只';
    } else {
      progressWrap.classList.add('hidden');
    }
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
    progressWrap.classList.add('hidden');
    if (_screenPollTimer) { clearInterval(_screenPollTimer); _screenPollTimer = null; }
  }
}

async function cancelScreening() {
  const cancelBtn = document.getElementById('loading-cancel-btn');
  try {
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = '0.5';
    cancelBtn.title = '正在取消...';
    document.getElementById('loading-sub').textContent = '正在取消，请稍候...';
    await fetch('/api/screen/cancel', { method: 'POST' });
  } catch (e) {
    cancelBtn.disabled = false;
    cancelBtn.style.opacity = '1';
    showMsg('取消失败: ' + e.message, 'red');
  }
}

function applyFormulaMask() {
  const mask = document.getElementById('formula-mask');
  const btn = document.getElementById('btn-toggle-formula-mask');
  if (!mask || !btn) return;
  if (_formulaMasked) {
    mask.classList.remove('hidden');
    btn.textContent = '显示公式';
  } else {
    mask.classList.add('hidden');
    btn.textContent = '隐藏公式';
  }
}

function toggleFormulaMask() {
  _formulaMasked = !_formulaMasked;
  applyFormulaMask();
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
