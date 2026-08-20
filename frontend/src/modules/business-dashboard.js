/* 经营看板模块 */

import { dashboard, forecast, budget, actual } from '../api/index.js';
import { formatNumber, getAchColor } from '../utils/index.js';

let FC_YEAR = new Date().getFullYear();
let FC_BATCH = '';
let FC_VERSION = 'V1';

/* 渲染页面 */
export function render() {
  return `
    <div class="page-title">📊 经营看板</div>
    <div class="page-subtitle">企业级经营数据汇总与达成分析（金额单位：万元）</div>

    <div class="filter-bar">
      <label class="filter-label">年度</label>
      <select class="filter-select" id="fcYearSel" onchange="onFcYearChange()">
        <option value="2024">2024年</option>
        <option value="2025">2025年</option>
        <option value="2026" selected>2026年</option>
        <option value="2027">2027年</option>
        <option value="2028">2028年</option>
      </select>
      <label class="filter-label">预测批次</label>
      <select class="filter-select" id="fcBatchSel" onchange="onFcBatchChange()" style="min-width:100px"></select>
      <label class="filter-label">版本</label>
      <select class="filter-select" id="fcVerSel" onchange="onFcVerChange()" style="min-width:80px">
        <option value="V1">V1</option>
        <option value="V2">V2</option>
        <option value="V3">V3</option>
      </select>
    </div>

    <div class="dash-card" id="fcAchGrid" style="display:flex;gap:20px;margin-bottom:20px">
      <div style="flex:1;text-align:center">
        <div style="color:var(--text-secondary);font-size:13px;margin-bottom:4px">预测收入</div>
        <div id="fcRevKpi" style="font-size:28px;font-weight:600">—</div>
      </div>
      <div style="flex:1;text-align:center">
        <div style="color:var(--text-secondary);font-size:13px;margin-bottom:4px">预测贡献利润</div>
        <div id="fcProfitKpi" style="font-size:28px;font-weight:600">—</div>
      </div>
      <div style="flex:1;text-align:center">
        <div style="color:var(--text-secondary);font-size:13px;margin-bottom:4px">贡献利润率</div>
        <div id="fcMarginKpi" style="font-size:28px;font-weight:600">—</div>
      </div>
      <div style="flex:1;text-align:center">
        <div style="color:var(--text-secondary);font-size:13px;margin-bottom:4px">现金流</div>
        <div id="fcCashKpi" style="font-size:28px;font-weight:600">—</div>
      </div>
    </div>

    <div class="dash-card full">
      <div class="chart-section-title">📈 经营预测趋势（按月）</div>
      <canvas id="fcTrendChart" style="width:100%;height:300px"></canvas>
    </div>

    <div class="dash-card full">
      <div class="chart-section-title">📊 达成率分析</div>
      <canvas id="fcAchChart" style="width:100%;height:280px"></canvas>
    </div>
  `;
}

/* 初始化 */
export function init() {
  loadForecastVersions();
}

/* 加载预测版本 */
async function loadForecastVersions() {
  try {
    const data = await forecast.versions();
    const sel = document.getElementById('fcBatchSel');
    if (!sel) return;

    sel.innerHTML = data.map(v =>
      `<option value="${v.fcMonth}">${String(v.fcMonth).slice(0,4)}-${String(v.fcMonth).slice(4)} [${v.version}]</option>`
    ).join('');

    if (data.length > 0) {
      FC_BATCH = data[0].fcMonth;
      FC_VERSION = data[0].version;
      sel.value = FC_BATCH;
    }
    loadForecastData();
  } catch (e) {
    console.error('loadForecastVersions:', e);
  }
}

/* 加载预测数据 */
async function loadForecastData() {
  try {
    const data = await forecast.dept({ year: FC_YEAR, fcMonth: FC_BATCH, version: FC_VERSION });
    renderForecastKpi(data);
  } catch (e) {
    console.error('loadForecastData:', e);
  }
}

/* 渲染 KPI */
function renderForecastKpi(data) {
  if (!data || !data.self) return;

  const self = data.self;
  const yData = self.data?.['全年'] || {};

  const rev = yData.forecast_revenue || 0;
  const profit = yData.forecast_profit || 0;
  const margin = rev > 0 ? (profit / rev * 100) : 0;
  const cash = yData.forecast_cash || 0;

  const revEl = document.getElementById('fcRevKpi');
  const profitEl = document.getElementById('fcProfitKpi');
  const marginEl = document.getElementById('fcMarginKpi');
  const cashEl = document.getElementById('fcCashKpi');

  if (revEl) revEl.textContent = formatNumber(rev);
  if (profitEl) profitEl.textContent = formatNumber(profit);
  if (marginEl) marginEl.textContent = margin.toFixed(1) + '%';
  if (cashEl) cashEl.textContent = formatNumber(cash);
}

/* 全局事件处理 */
window.onFcYearChange = function() {
  const sel = document.getElementById('fcYearSel');
  if (sel) {
    FC_YEAR = parseInt(sel.value, 10);
    loadForecastData();
  }
};

window.onFcBatchChange = function() {
  const sel = document.getElementById('fcBatchSel');
  if (sel) {
    FC_BATCH = sel.value;
    loadForecastData();
  }
};

window.onFcVerChange = function() {
  const sel = document.getElementById('fcVerSel');
  if (sel) {
    FC_VERSION = sel.value;
    loadForecastData();
  }
};

export default { render, init };
