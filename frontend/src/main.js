/* 前端入口文件 */

import { initApp, switchTab, doLogin, doLogout } from './utils/index.js';

// 挂载全局函数（供 HTML onclick 调用）
window.doLogin = doLogin;
window.doLogout = doLogout;
window.switchTab = switchTab;

// 导航点击事件
document.addEventListener('DOMContentLoaded', () => {
  // 绑定导航点击
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const tab = el.dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  // 初始化应用
  initApp();
});
