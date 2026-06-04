// ─── 全局状态 ──────────────────────────────────────────────────────────
let currentFormulaType = 'tdx';
let screenResults = [];
let screenResultsView = [];
let screenDate = '';
let klineChart = null;
let histogramChart = null;
let templates = {};
const SCREEN_WARMUP_KEY = 'screen_warmed_up_v1';
let _screenLoadingBaseTitle = '正在选股...';
let _returnSortState = { key: null, order: 'default' };
let _formulaMasked = true;

// ─── 初始化 ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 加载公式模板
  try {
    const resp = await fetch('/api/formula/templates');
    templates = await resp.json();
    updateTemplateDropdown();
  } catch(e) { console.warn('Failed to load templates:', e); }

  // 窗口缩放时自适应图表
  window.addEventListener('resize', () => {
    if (klineChart) klineChart.resize();
    if (histogramChart) histogramChart.resize();
  });

  // 加载策略列表和数据状态
  loadStrategies();
  loadDataStatus();
  applyFormulaMask();
});

// ─── 标签切换 ──────────────────────────────────────────────────────────
function switchTab(type) {
  currentFormulaType = type;
  ['tdx', 'python', 'pseudo'].forEach(t => {
    const btn = document.getElementById('tab-' + t);
    if (t === type) {
      btn.className = btn.className.replace('tab-inactive', 'tab-active');
    } else {
      btn.className = btn.className.replace('tab-active', 'tab-inactive');
    }
  });
  updateTemplateDropdown();

  const editor = document.getElementById('formula-editor');
  const placeholders = {
    tdx: '输入通达信公式...\n例: CROSS(MA(CLOSE, 5), MA(CLOSE, 10))',
    python: '输入Python表达式...\n例: cross(ma(close, 5), ma(close, 10))',
    pseudo: '输入中文伪代码...\n例: 5日均线 上穿 10日均线',
  };
  editor.placeholder = placeholders[type] || '';
}

// ─── 模板管理 ──────────────────────────────────────────────────────────
function updateTemplateDropdown() {
  const select = document.getElementById('template-select');
  const items = templates[currentFormulaType] || [];
  select.innerHTML = '<option value="">选择模板...</option>';
  items.forEach((t, i) => {
    select.innerHTML += `<option value="${i}" title="${t.description}">${t.name}</option>`;
  });
}

function loadTemplate(idx) {
  if (idx === '') return;
  const items = templates[currentFormulaType] || [];
  const t = items[parseInt(idx)];
  if (t) {
    document.getElementById('formula-editor').value = t.formula;
  }
  document.getElementById('template-select').value = '';
}

// ─── 公式验证 ──────────────────────────────────────────────────────────
async function validateFormula() {
  const formula = document.getElementById('formula-editor').value.trim();
  if (!formula) { showMsg('请输入公式', 'red'); return; }

  try {
    const resp = await fetch('/api/formula/validate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ formula, formula_type: currentFormulaType }),
    });
    const data = await resp.json();
    if (data.valid) {
      showMsg('公式有效', 'green');
    } else {
      showMsg(data.message, 'red');
    }
  } catch(e) {
    showMsg('验证失败: ' + e.message, 'red');
  }
}
