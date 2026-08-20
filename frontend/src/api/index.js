/* API 封装模块 */

const API_BASE = '';

/* 获取 token */
function getToken() {
  return localStorage.getItem('wb_ops_token');
}

/* 设置 token */
function setToken(token) {
  localStorage.setItem('wb_ops_token', token);
}

/* 清除 token */
function clearToken() {
  localStorage.removeItem('wb_ops_token');
}

/* 通用请求 */
async function apiRequest(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers
  });

  if (response.status === 401) {
    clearToken();
    showLogin();
    throw new Error('未登录或会话已过期');
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

/* GET 请求 */
export async function get(url) {
  return apiRequest(url, { method: 'GET' });
}

/* POST 请求 */
export async function post(url, body) {
  return apiRequest(url, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/* PUT 请求 */
export async function put(url, body) {
  return apiRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

/* DELETE 请求 */
export async function del(url) {
  return apiRequest(url, { method: 'DELETE' });
}

/* ===== 业务 API ===== */

// 登录
export async function login(username, password) {
  const data = await post('/api/auth/login', { username, password });
  if (data.token) {
    setToken(data.token);
  }
  return data;
}

// 登出
export async function logout() {
  await post('/api/auth/logout', {});
  clearToken();
}

// 获取当前用户
export async function getCurrentUser() {
  return get('/api/auth/me');
}

// 经营记录
export const records = {
  list: () => get('/api/records'),
  get: (id) => get(`/api/records/${id}`),
  create: (data) => post('/api/records', data),
  update: (data) => put('/api/records', data),
  delete: (id) => del(`/api/records?id=${id}`)
};

// 预测
export const forecast = {
  versions: () => get('/api/forecast/versions'),
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return get(`/api/forecast?${q}`);
  },
  batch: (data) => post('/api/forecast/batch', data),
  clone: (data) => post('/api/forecast/clone', data),
  dept: (params) => {
    const q = new URLSearchParams(params).toString();
    return get(`/api/forecast/dept?${q}`);
  }
};

// 预算
export const budget = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return get(`/api/budget?${q}`);
  },
  batch: (data) => post('/api/budget/batch', data)
};

// 实际
export const actual = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return get(`/api/actual?${q}`);
  },
  batch: (data) => post('/api/actual/batch', data)
};

// 预算流
export const budgetFlow = {
  tree: (params) => {
    const q = new URLSearchParams(params).toString();
    return get(`/api/budget-flow/tree?${q}`);
  },
  orgs: () => get('/api/budget-flow/orgs'),
  dept: (params) => {
    const q = new URLSearchParams(params).toString();
    return get(`/api/budget-flow/dept?${q}`);
  },
  versions: (params) => {
    const q = new URLSearchParams(params).toString();
    return get(`/api/budget-flow/versions?${q}`);
  },
  collect: (data) => post('/api/budget-flow/collect', data),
  allocate: (data) => post('/api/budget-flow/allocate', data),
  submit: (data) => post('/api/budget-flow/submit', data)
};

// 预算版本
export const budgetVersion = {
  list: (year) => get(`/api/budget-version?year=${year}`),
  create: (data) => post('/api/budget-version', data),
  activate: (id) => post('/api/budget-version/activate', { id }),
  complete: (id) => post('/api/budget-version/complete', { id })
};

// 目标拆分
export const targetSplit = {
  list: (year) => get(`/api/target-split?year=${year}`),
  batch: (data) => post('/api/target-split/batch', data)
};

// 表元数据
export const tableMeta = {
  tree: () => get('/api/table-meta/tree'),
  list: (type) => get(`/api/table-meta?type=${type || ''}`),
  get: (id) => get(`/api/table-meta/${id}`),
  create: (data) => post('/api/table-meta', data),
  update: (data) => put('/api/table-meta', data),
  delete: (id) => del(`/api/table-meta?id=${id}`)
};

// RBAC
export const rbac = {
  users: {
    list: () => get('/api/admin/users'),
    create: (data) => post('/api/admin/users', data)
  },
  roles: {
    list: () => get('/api/admin/roles'),
    create: (data) => post('/api/admin/roles', data)
  },
  permissions: {
    list: () => get('/api/admin/permissions')
  },
  orgs: {
    list: (parentId) => get(`/api/admin/orgs?parentId=${parentId || ''}`),
    create: (data) => post('/api/admin/orgs', data)
  },
  orgTemplates: {
    list: () => get('/api/admin/org-templates'),
    create: (data) => post('/api/admin/org-templates', data)
  }
};

// 看板
export const dashboard = {
  summary: (year) => get(`/api/dashboard/summary?year=${year}`),
  kpi: (year) => get(`/api/dashboard/kpi?year=${year}`)
};

export default {
  get, post, put, del,
  login, logout, getCurrentUser,
  records, forecast, budget, actual, budgetFlow, budgetVersion, targetSplit, tableMeta, rbac, dashboard
};
