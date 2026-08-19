/* 前端「全部 BU 对比」功能验证:
 * 1. BU 下拉含「全部 BU 对比」选项
 * 2. 切 __all__: fcVerInfo 显示「全部 BU 对比」; 图表标题=各 BU 收入实际达成率对比
 * 3. 表格: thead 含 5 BU 列; 12 月 + 全年合计 13 行; 全年合计汇总金额正确
 * 4. KPI 区: 含「各 BU 全年实际收入 vs 预算」速览
 * 5. 对比模式录入拦截: openBudgetModal/openActualModal/openForecastModal/exportForecast → toast 提示
 * 6. setForecastDim('quarter') → 4 季 + 全年合计 5 行
 * 7. 切回 汇总 → 普通视图恢复 (11 列表头)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join('C:/Users/hcfei/.workbuddy/binaries/node/workspace/node_modules', 'jsdom'));

const HTML = fs.readFileSync(path.join(__dirname, '运营管理平台.html'), 'utf8');

const BUS = ['汇总', '软工', '硬工', '云', '智能汽车'];
// 各 BU 月度预算基数 (预算收入, 预算利润)
const BUD_BASE = { '软工': [1000, 100], '硬工': [800, 80], '云': [600, 60], '智能汽车': [400, 40] };
// 各 BU 月度实际基数 (达成率: 软工90% 硬工100% 云110% 智能汽车80%)
const ACT_BASE = { '软工': [900, 90], '硬工': [800, 80], '云': [660, 66], '智能汽车': [320, 32] };

function mkBud(bu, m, base) {
  return { '_id': 'b_' + bu + '_' + m, '年度': 2026, '月份': m, 'BU': bu,
    '预算收入': base[0] * m, '预算贡献利润': base[1] * m, '预算现金流': 0, '预算费用': 0 };
}
function mkAct(bu, m, base) {
  return { '_id': 'a_' + bu + '_' + m, '年度': 2026, '月份': m, 'BU': bu,
    '实际收入': base[0] * m, '实际贡献利润': base[1] * m, '实际现金流': 0, '实际费用': 0 };
}
function mkFc(bu, m, base) {
  return { '_id': 'f_' + bu + '_' + m, '年度': 2026, '月份': m, 'BU': bu,
    '预测收入': base[0] * m, '贡献利润': base[1] * m, '现金流': 0, '费用': 0, '备注': '', '预测批次': 202608, '版本': 'V1' };
}
function sumBase(bases, fn, m) {
  return BUS.filter(b => b !== '汇总').reduce((s, b) => s + fn(bases[b], m), 0);
}
// 汇总行 = 4 BU 之和 (fn 签名 (baseArr, m) => 值)
function mkSumRows(kind) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    if (kind === 'fc') out.push(mkFc('汇总', m, [sumBase(BUD_BASE, (b, mm) => b[0] * mm, m), sumBase(BUD_BASE, (b, mm) => b[1] * mm, m)]));
    else if (kind === 'bud') out.push(mkBud('汇总', m, [sumBase(BUD_BASE, (b, mm) => b[0] * mm, m), sumBase(BUD_BASE, (b, mm) => b[1] * mm, m)]));
  }
  return out;
}
function mkSumActual() {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ '_id': 'agg_' + m, '年度': 2026, '月份': m, 'BU': '汇总',
      '实际收入': sumBase(ACT_BASE, (b, mm) => b[0] * mm, m), '实际贡献利润': sumBase(ACT_BASE, (b, mm) => b[1] * mm, m), '实际现金流': 0, '实际费用': 0, '备注': '' });
  }
  return out;
}
function mkBuRows(kind, bu) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    if (kind === 'fc') out.push(mkFc(bu, m, BUD_BASE[bu]));
    else if (kind === 'bud') out.push(mkBud(bu, m, BUD_BASE[bu]));
    else out.push(mkAct(bu, m, ACT_BASE[bu]));
  }
  return out;
}

function respond(data, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(data) });
}
let results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const dom = new JSDOM(HTML, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.includes('/api/forecast/versions')) return respond([{ fcMonth: 202608, version: 'V1', year: 2026, count: 12 }]);
      if (u.includes('/api/forecast?')) {
        const m = u.match(/bu=([^&]+)/);
        const bu = m ? decodeURIComponent(m[1]) : null;
        if (!bu) {
          // 不带 bu: 返回所有 BU
          let rows = [];
          BUS.forEach(b => { rows = rows.concat(b === '汇总' ? mkSumRows('fc') : mkBuRows('fc', b)); });
          return respond(rows);
        }
        return respond(bu === '汇总' ? mkSumRows('fc') : mkBuRows('fc', bu));
      }
      if (u.includes('/api/budget')) {
        const m = u.match(/bu=([^&]+)/);
        const bu = m ? decodeURIComponent(m[1]) : null;
        if (!bu) { let rows = []; BUS.forEach(b => { rows = rows.concat(b === '汇总' ? mkSumRows('bud') : mkBuRows('bud', b)); }); return respond(rows); }
        return respond(bu === '汇总' ? mkSumRows('bud') : mkBuRows('bud', bu));
      }
      if (u.includes('/api/actual')) {
        const m = u.match(/bu=([^&]+)/);
        const bu = m ? decodeURIComponent(m[1]) : '汇总';
        return respond(bu === '汇总' ? mkSumActual() : mkBuRows('act', bu));
      }
      if (u.includes('/api/target-split')) return respond([]);
      if (u.includes('/api/records')) return respond([]);
      return respond({ error: 'unhandled ' + u }, false);
    };
    window.URL.createObjectURL = () => 'blob:mock';
    window.URL.revokeObjectURL = () => {};
  }
});
const w = dom.window;

w.addEventListener('DOMContentLoaded', () => {
  w.toast = (msg, type) => { (w.__toasts = w.__toasts || []).push(type + ':' + msg); console.log('[toast]', type, msg); };
  w.showConfirm = (msg, cb) => { w.__lastConfirmMsg = msg; w.__confirmCb = cb; };
});

setTimeout(() => {
  try {
    // 1. BU 下拉含「全部 BU 对比」
    const sel = w.document.getElementById('fcBuSel');
    check('BU 下拉存在', !!sel);
    const vals = sel ? Array.from(sel.options).map(o => o.value) : [];
    check('BU 下拉含 __all__ 选项', vals.includes('__all__') && vals.length === 6, vals.join(','));

    // 2. 切到 __all__
    sel.value = '__all__';
    w.onFcBuChange();
    setTimeout(() => {
      const verInfo = w.document.getElementById('fcVerInfo').textContent;
      check('fcVerInfo 显示全部 BU 对比', verInfo.includes('全部 BU 对比'), verInfo);

      const chartTitle = w.document.getElementById('fcAchChartTitle').textContent;
      check('图表标题 = 各BU收入实际达成率对比', chartTitle === '各月 各 BU 收入实际达成率对比', chartTitle);

      const thead = w.document.getElementById('forecastHead').innerHTML;
      check('表格 thead 含 5 BU 列', ['汇总', '软工', '硬工', '云', '智能汽车'].every(b => thead.includes(b)), 'len=' + thead.length);

      const tbody = w.document.getElementById('forecastBody');
      const rows = tbody.querySelectorAll('tr');
      check('表格 13 行 (12月+全年合计)', rows.length === 13, 'rows=' + rows.length);
      check('表格含全年合计行', tbody.innerHTML.includes('全年合计'));

      // 全年合计行: 汇总实际 = Σ(900+800+660+320)*m = 2680*78 = 209040
      const lastRow = rows[rows.length - 1].innerHTML;
      check('全年合计汇总金额 = 209,040.00', lastRow.includes('209,040.00'), lastRow.slice(0, 120));

      const kpi = w.document.getElementById('fcAchGrid').innerHTML;
      check('KPI 区含各 BU 全年速览', kpi.includes('各 BU 全年实际收入 vs 预算') && ['软工', '硬工', '云', '智能汽车'].every(b => kpi.includes(b)));

      // 3. 录入拦截
      w.__toasts = [];
      w.openBudgetModal(); w.openActualModal(); w.openForecastModal(); w.exportForecast();
      const warns = w.__toasts.filter(t => t.startsWith('warn:'));
      check('对比模式录入/导出均被拦截(4次warn)', warns.length === 4, 'warns=' + warns.length + ' -> ' + warns.join(';'));

      // 4. 切季度
      w.setForecastDim('quarter');
      setTimeout(() => {
        const rowsQ = w.document.getElementById('forecastBody').querySelectorAll('tr');
        check('季度视图 5 行 (4季+全年合计)', rowsQ.length === 5, 'rows=' + rowsQ.length);
        const chartQ = w.document.getElementById('fcAchChartTitle').textContent;
        check('季度图表标题正确', chartQ === '各季度 各 BU 收入实际达成率对比', chartQ);

        // 5. 切回 汇总 恢复普通视图
        sel.value = '汇总';
        w.onFcBuChange();
        setTimeout(() => {
          const theadN = w.document.getElementById('forecastHead').innerHTML;
          const ths = (theadN.match(/<th/g) || []).length;
          check('切回汇总恢复 11 列表头', ths === 11, 'ths=' + ths);
          const chartN = w.document.getElementById('fcAchChartTitle').textContent;
          check('切回汇总图表标题恢复', chartN.includes('收入 · 贡献利润实际达成率'), chartN);
          finish();
        }, 350);
      }, 250);
    }, 400);
  } catch (e) {
    console.error('TEST ERROR:', e.message);
    process.exit(1);
  }
}, 800);

function finish() {
  const fails = results.filter(r => !r.ok);
  console.log('\n===== ' + (fails.length === 0 ? 'ALL PASS (' + results.length + ')' : fails.length + ' FAILED / ' + results.length) + ' =====');
  process.exit(fails.length === 0 ? 0 : 1);
}
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 20000);
