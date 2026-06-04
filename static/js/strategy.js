// ─── 策略管理 ──────────────────────────────────────────────────────────

let savedStrategies = [];

async function loadStrategies() {
  try {
    const resp = await fetch('/api/strategies');
    const data = await resp.json();
    savedStrategies = data.strategies || [];
    updateStrategyCount();
    renderStrategyList();
  } catch(e) { console.warn('Failed to load strategies:', e); }
}

function updateStrategyCount() {
  const el = document.getElementById('strategy-count');
  el.textContent = savedStrategies.length > 0 ? `(${savedStrategies.length})` : '';
}

function openSaveDialog(existingId) {
  const dialog = document.getElementById('save-dialog');
  const formula = document.getElementById('formula-editor').value.trim();
  if (!formula && !existingId) { showMsg('请先输入公式', 'red'); return; }

  if (existingId) {
    const s = savedStrategies.find(x => x.id === existingId);
    if (s) {
      document.getElementById('save-strategy-id').value = s.id;
      document.getElementById('save-name').value = s.name;
      document.getElementById('save-desc').value = s.description || '';
      document.getElementById('save-formula-preview').textContent = s.formula;
      document.getElementById('save-formula-type-label').textContent = {tdx:'TDX',python:'Python',pseudo:'伪代码'}[s.formula_type] || s.formula_type;
      const filters = [];
      if (s.exclude_st) filters.push('排除ST');
      if (s.market_filter) filters.push(s.market_filter);
      document.getElementById('save-filter-label').textContent = filters.join(' | ') || '全部市场';
    }
  } else {
    document.getElementById('save-strategy-id').value = '';
    document.getElementById('save-name').value = '';
    document.getElementById('save-desc').value = '';
    document.getElementById('save-formula-preview').textContent = formula;
    document.getElementById('save-formula-type-label').textContent = {tdx:'TDX',python:'Python',pseudo:'伪代码'}[currentFormulaType];
    const filters = [];
    if (document.getElementById('exclude-st').checked) filters.push('排除ST');
    const mf = document.getElementById('market-filter').value;
    if (mf) filters.push(mf);
    document.getElementById('save-filter-label').textContent = filters.join(' | ') || '全部市场';
  }
  dialog.classList.remove('hidden');
  document.getElementById('save-name').focus();
}

function closeSaveDialog() {
  document.getElementById('save-dialog').classList.add('hidden');
}

async function confirmSaveStrategy() {
  const name = document.getElementById('save-name').value.trim();
  if (!name) { showMsg('请输入策略名称', 'red'); return; }

  const existingId = document.getElementById('save-strategy-id').value || null;
  const formula = existingId
    ? (savedStrategies.find(x => x.id === existingId)?.formula || document.getElementById('formula-editor').value.trim())
    : document.getElementById('formula-editor').value.trim();
  const formulaType = existingId
    ? (savedStrategies.find(x => x.id === existingId)?.formula_type || currentFormulaType)
    : currentFormulaType;

  try {
    const resp = await fetch('/api/strategies', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        id: existingId,
        name: name,
        description: document.getElementById('save-desc').value.trim(),
        formula: formula,
        formula_type: formulaType,
        exclude_st: document.getElementById('exclude-st').checked,
        market_filter: document.getElementById('market-filter').value || null,
      }),
    });
    const data = await resp.json();
    if (data.success) {
      savedStrategies = data.strategies;
      updateStrategyCount();
      renderStrategyList();
      closeSaveDialog();
      showMsg(existingId ? '策略已更新' : '策略已保存', 'green');
    }
  } catch(e) {
    showMsg('保存失败: ' + e.message, 'red');
  }
}

function toggleStrategyPanel() {
  const panel = document.getElementById('strategy-panel');
  const backdrop = document.getElementById('strategy-backdrop');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    backdrop.classList.add('hidden');
  } else {
    loadStrategies();
    panel.classList.add('open');
    backdrop.classList.remove('hidden');
  }
}

function renderStrategyList() {
  const container = document.getElementById('strategy-list');
  if (savedStrategies.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-500 py-8 text-sm">暂无保存的策略</div>';
    return;
  }

  const typeLabels = {tdx:'TDX', python:'Python', pseudo:'伪代码'};
  container.innerHTML = savedStrategies.map(s => {
    const typeLabel = typeLabels[s.formula_type] || s.formula_type;
    const filters = [];
    if (s.exclude_st) filters.push('排除ST');
    if (s.market_filter) filters.push(s.market_filter);
    const filterStr = filters.length > 0 ? filters.join(', ') : '全部';
    const time = s.updated_at ? s.updated_at.slice(0, 16).replace('T', ' ') : '';

    return `
      <div class="strategy-card bg-gray-800 border border-gray-700 rounded-lg p-3 cursor-pointer" onclick="applyStrategy('${s.id}')">
        <div class="flex items-start justify-between mb-1.5">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-200 truncate">${esc(s.name)}</div>
            ${s.description ? `<div class="text-xs text-gray-500 mt-0.5 truncate">${esc(s.description)}</div>` : ''}
          </div>
          <div class="flex items-center gap-1 ml-2 flex-shrink-0">
            <button onclick="event.stopPropagation(); openSaveDialog('${s.id}')" title="编辑"
              class="text-gray-500 hover:text-blue-400 p-1 rounded transition-colors text-xs">&#9998;</button>
            <button onclick="event.stopPropagation(); deleteStrategy('${s.id}', '${esc(s.name)}')" title="删除"
              class="text-gray-500 hover:text-red-400 p-1 rounded transition-colors text-xs">&#10005;</button>
          </div>
        </div>
        <pre class="text-xs text-gray-400 font-mono bg-gray-900/60 rounded px-2 py-1.5 whitespace-pre-wrap max-h-[60px] overflow-hidden mb-2">${esc(s.formula)}</pre>
        <div class="flex items-center gap-2 text-xs text-gray-500">
          <span class="px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">${typeLabel}</span>
          <span>${filterStr}</span>
          <span class="ml-auto">${time}</span>
        </div>
      </div>
    `;
  }).join('');
}

function applyStrategy(id) {
  const s = savedStrategies.find(x => x.id === id);
  if (!s) return;
  switchTab(s.formula_type);
  document.getElementById('formula-editor').value = s.formula;
  document.getElementById('exclude-st').checked = s.exclude_st;
  document.getElementById('market-filter').value = s.market_filter || '';
  toggleStrategyPanel();
  showMsg(`已加载策略: ${s.name}`, 'green');
}

async function deleteStrategy(id, name) {
  if (!confirm(`确定要删除策略 "${name}" 吗？`)) return;
  try {
    const resp = await fetch(`/api/strategies/${id}`, { method: 'DELETE' });
    const data = await resp.json();
    if (data.success) {
      savedStrategies = data.strategies;
      updateStrategyCount();
      renderStrategyList();
      showMsg('策略已删除', 'green');
    }
  } catch(e) {
    showMsg('删除失败: ' + e.message, 'red');
  }
}
