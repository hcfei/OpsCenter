/* 工具函数模块 */

import { login as apiLogin, logout as apiLogout, getCurrentUser } from '../api/index.js';

/* 显示登录遮罩 */
export function showLogin() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.remove('hidden');
}

/* 隐藏登录遮罩 */
export function hideLogin() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('hidden');
}

/* 执行登录 */
export async function doLogin() {
  const username = document.getElementById('loginUsername')?.value || '';
  const password = document.getElementById('loginPassword')?.value || '';

  if (!username || !password) {
    alert('请输入用户名和密码');
    return;
  }

  try {
    const result = await apiLogin(username, password);
    hideLogin();
    await initApp();
  } catch (e) {
    alert('登录失败: ' + e.message);
  }
}

/* 执行登出 */
export async function doLogout() {
  try {
    await apiLogout();
  } catch (e) {
    console.error('登出失败:', e);
  }
  showLogin();
}

/* 初始化应用 */
export async function initApp() {
  try {
    const user = await getCurrentUser();
    console.log('当前用户:', user);
    hideLogin();
    // 初始化默认页面
    switchTab('dashboard');
  } catch (e) {
    console.log('需要登录');
    showLogin();
  }
}

/* 切换 Tab */
export function switchTab(tabName) {
  // 更新导航状态
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabName);
  });

  // 加载对应模块
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;

  // 动态加载模块
  const moduleMap = {
    'dashboard': () => import('./modules/business-dashboard.js'),
    'forecast': () => import('./modules/forecast.js'),
    'budget': () => import('./modules/budget.js'),
    'budget-flow': () => import('./modules/budget-flow.js'),
    'ops': () => import('./modules/ops-dashboard.js'),
    'target': () => import('./modules/target-split.js'),
    'records': () => import('./modules/records.js'),
    'contracts': () => import('./modules/contracts.js'),
    'projects': () => import('./modules/projects.js'),
    'acceptance': () => import('./modules/acceptance.js'),
    'payments': () => import('./modules/payments.js'),
    'table-mgmt': () => import('./modules/table-meta.js'),
    'admin': () => import('./modules/admin.js')
  };

  const loader = moduleMap[tabName];
  if (loader) {
    loader().then(module => {
      if (module && module.render) {
        mainContent.innerHTML = module.render();
        if (module.init) module.init();
      }
    });
  } else {
    mainContent.innerHTML = `<div class="page-title">${tabName}</div><p>功能开发中...</p>`;
  }
}

/* 格式化数字 */
export function formatNumber(num, decimals = 2) {
  if (num == null || isNaN(num)) return '0';
  return Number(num).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/* 格式化百分比 */
export function formatPercent(value, decimals = 1) {
  if (value == null || isNaN(value)) return '—';
  return (value * 100).toFixed(decimals) + '%';
}

/* 获取达成率颜色 */
export function getAchColor(value) {
  if (!value || value <= 0) return 'var(--text-muted)';
  if (value >= 95) return 'var(--success)';
  if (value >= 70) return 'var(--warning)';
  return 'var(--danger)';
}

/* DOM 工具 */
export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return document.querySelectorAll(selector);
}

/* 创建元素 */
export function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on')) {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  });
  children.forEach(child => {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  });
  return el;
}

export default {
  showLogin, hideLogin, doLogin, doLogout, initApp, switchTab,
  formatNumber, formatPercent, getAchColor,
  $, $$, createElement
};
