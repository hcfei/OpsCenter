/* 预算流路由模块
 * API:
 *   GET/POST   /api/budget-flow           - 预算流 CRUD
 *   GET        /api/budget-flow/tree     - 预算状态树
 *   GET        /api/budget-flow/orgs     - 组织列表
 *   GET        /api/budget-flow/dept     - 按部门查询
 *   GET        /api/budget-flow/versions - 版本列表
 *   POST       /api/budget-flow/collect - 汇总下级预算
 *   POST       /api/budget-flow/allocate - 分解预算到下级
 *   POST       /api/budget-flow/submit   - 提交审批
 *   GET/POST   /api/budget-version       - 版本管理
 *   POST       /api/budget-version/activate - 激活版本
 *   POST       /api/budget-version/complete - 完成版本
 */

let registerRoute, getPool, send, readBody;

const ROOT_ORG_ID = 25;
const BUDGET_PERIODS = [
  { code: '1月', label: '1月' }, { code: '2月', label: '2月' }, { code: '3月', label: '3月' },
  { code: '4月', label: '4月' }, { code: '5月', label: '5月' }, { code: '6月', label: '6月' },
  { code: '7月', label: '7月' }, { code: '8月', label: '8月' }, { code: '9月', label: '9月' },
  { code: '10月', label: '10月' }, { code: '11月', label: '11月' }, { code: '12月', label: '12月' },
  { code: 'Q1', label: 'Q1' }, { code: 'Q2', label: 'Q2' }, { code: 'Q3', label: 'Q3' }, { code: 'Q4', label: 'Q4' },
  { code: 'H1', label: 'H1' }, { code: 'H2', label: 'H2' }, { code: '全年', label: '全年' }
];

function budgetLevelOf(depth) {
  const LEVELS = { 1: '集团', 2: 'BG', 3: 'BD', 4: '领域', 5: 'BU' };
  return LEVELS[depth] || '未知';
}

function budgetRowToApi(row) {
  const api = { _id: String(row.id), 年度: row.year, 月份: row.month, BU: row.bu || '汇总' };
  api['预算收入'] = row.budget_revenue != null ? Number(row.budget_revenue) : 0;
  api['预算贡献利润'] = row.budget_profit != null ? Number(row.budget_profit) : 0;
  api['预算现金流'] = row.budget_cash != null ? Number(row.budget_cash) : 0;
  api['预算费用'] = row.budget_expense != null ? Number(row.budget_expense) : 0;
  if (row.created_at) api['创建时间'] = row.created_at;
  if (row.updated_at) api['更新时间'] = row.updated_at;
  return api;
}

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;

  // GET /api/budget - 查询预算
  registerRoute('GET', '/api/budget', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const year = urlObj.searchParams.get('year');
    const bu = urlObj.searchParams.get('bu');
    const orgId = urlObj.searchParams.get('org_id');

    let sql = 'SELECT * FROM ops_budget WHERE 1=1';
    const params = [];
    if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
    if (bu) { sql += ' AND bu=?'; params.push(String(bu)); }
    if (orgId) { sql += ' AND org_id=?'; params.push(parseInt(orgId, 10)); }
    sql += ' ORDER BY year ASC, month ASC';

    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows.map(budgetRowToApi));
  });

  // POST /api/budget - 新增预算
  registerRoute('POST', '/api/budget', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const db = {
      year: parseInt(body['年度'], 10),
      month: parseInt(body['月份'], 10),
      bu: body['BU'] || '汇总',
      budget_revenue: parseFloat(body['预算收入']) || 0,
      budget_profit: parseFloat(body['预算贡献利润']) || 0,
      budget_cash: parseFloat(body['预算现金流']) || 0,
      budget_expense: parseFloat(body['预算费用']) || 0
    };
    if (!db.year || !db.month) return ctx.send(400, { error: 'year and month required' });

    const [r] = await pool.query(
      'INSERT INTO ops_budget (year, month, bu, budget_revenue, budget_profit, budget_cash, budget_expense) VALUES (?,?,?,?,?,?,?)',
      [db.year, db.month, db.bu, db.budget_revenue, db.budget_profit, db.budget_cash, db.budget_expense]
    );
    ctx.send(201, { _id: String(r.insertId) });
  });

  // GET /api/budget-flow/orgs - 组织列表
  registerRoute('GET', '/api/budget-flow/orgs', async (ctx) => {
    const pool = ctx.pool;
    const [rows] = await pool.query(
      'SELECT id, name, parent_id, depth FROM sys_org WHERE status=1 ORDER BY sort ASC, id ASC'
    );
    // 构建层级路径
    const buildPath = (id) => {
      const path = [];
      let curr = rows.find(r => r.id === id);
      while (curr) { path.unshift(curr.name); curr = rows.find(r => r.id === curr.parent_id); }
      return path.join(' / ');
    };
    ctx.send(200, rows.map(r => ({
      id: r.id, name: r.name, parentId: r.parent_id, depth: r.depth,
      level: budgetLevelOf(r.depth), fullName: buildPath(r.id)
    })));
  });

  // GET /api/budget-flow/dept - 按部门查询
  registerRoute('GET', '/api/budget-flow/dept', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const year = parseInt(urlObj.searchParams.get('year') || new Date().getFullYear(), 10);
    const version = urlObj.searchParams.get('version') || 'V1';
    const versionType = urlObj.searchParams.get('version_type') || 'estimate';
    const orgId = parseInt(urlObj.searchParams.get('orgId'), 10);
    if (!orgId) return ctx.send(400, { error: 'orgId required' });

    const [[org]] = await pool.query('SELECT id, name, parent_id, depth FROM sys_org WHERE id=?', [orgId]);
    if (!org) return ctx.send(404, { error: 'org not found' });

    // 递归获取子部门（带深度限制）
    const MAX_DEPTH = 10;
    const getAllChildren = async (parentId, depth = 0) => {
      if (depth > MAX_DEPTH) return [];
      const [kids] = await pool.query('SELECT id, name, parent_id, depth FROM sys_org WHERE parent_id=? AND status=1 ORDER BY sort ASC, id ASC', [parentId]);
      let result = [...kids];
      for (const kid of kids) {
        const grandKids = await getAllChildren(kid.id, depth + 1);
        result = result.concat(grandKids);
      }
      return result;
    };

    const allChildren = await getAllChildren(orgId);
    const allIds = [orgId, ...allChildren.map(c => c.id)];
    const placeholders = allIds.map(() => '?').join(',');
    const [flows] = await pool.query(
      `SELECT org_id, period, budget_revenue, budget_profit, budget_cash, status, source FROM ops_budget_flow WHERE year=? AND version=? AND org_id IN (${placeholders})`,
      [year, version, ...allIds]
    );

    const flowByOrg = {};
    allIds.forEach(id => { flowByOrg[id] = {}; });
    flows.forEach(f => {
      if (!flowByOrg[f.org_id]) flowByOrg[f.org_id] = {};
      flowByOrg[f.org_id][f.period] = {
        budget_revenue: Number(f.budget_revenue) || 0,
        budget_profit: Number(f.budget_profit) || 0,
        budget_cash: Number(f.budget_cash) || 0,
        status: f.status, source: f.source
      };
    });

    const self = { id: org.id, name: org.name, level: budgetLevelOf(org.depth), depth: org.depth, data: flowByOrg[orgId] || {} };
    const childList = allChildren.map(c => ({
      id: c.id, name: c.name, level: budgetLevelOf(c.depth), depth: c.depth, data: flowByOrg[c.id] || {}
    }));

    ctx.send(200, { year, version, versionType, orgId, periods: BUDGET_PERIODS, self, children: childList });
  });

  // POST /api/budget-flow/collect - 汇总下级预算
  registerRoute('POST', '/api/budget-flow/collect', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const year = parseInt(body.year, 10);
    const version = body.version || 'V1';
    const period = body.period || 'Q1';
    const targetOrgId = parseInt(body.targetOrgId, 10);
    if (!year || !targetOrgId) return ctx.send(400, { error: 'year and targetOrgId required' });

    const [orgs] = await pool.query('SELECT id, name, parent_id FROM sys_org WHERE status=1');
    const getAllChildren = (parentId) => {
      const children = orgs.filter(o => o.parent_id === parentId);
      let result = [...children];
      children.forEach(c => { result = result.concat(getAllChildren(c.id)); });
      return result;
    };
    const allChildren = getAllChildren(targetOrgId);
    if (allChildren.length === 0) return ctx.send(400, { error: 'no child orgs to collect' });

    let totalRevenue = 0, totalProfit = 0, totalCash = 0;
    for (const c of allChildren) {
      const [[f]] = await pool.query(
        'SELECT budget_revenue, budget_profit, budget_cash FROM ops_budget_flow WHERE year=? AND version=? AND period=? AND org_id=?',
        [year, version, period, c.id]
      );
      if (f) {
        totalRevenue += Number(f.budget_revenue) || 0;
        totalProfit += Number(f.budget_profit) || 0;
        totalCash += Number(f.budget_cash) || 0;
      }
    }

    const [[org]] = await pool.query('SELECT depth FROM sys_org WHERE id=?', [targetOrgId]);
    const level = org && org.depth === 3 ? 'BD' : '领域';
    await pool.query(
      `INSERT INTO ops_budget_flow (year, version, period, org_id, level, status, source, budget_revenue, budget_profit, budget_cash)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE budget_revenue=VALUES(budget_revenue), budget_profit=VALUES(budget_profit), budget_cash=VALUES(budget_cash), status=VALUES(status), source=VALUES(source)`,
      [year, version, period, targetOrgId, level, 'draft', 'collected', totalRevenue, totalProfit, totalCash]
    );

    ctx.send(200, { ok: true, collected: allChildren.length, totalRevenue, totalProfit, totalCash });
  });

  // GET /api/budget-version - 版本列表
  registerRoute('GET', '/api/budget-version', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const year = parseInt(urlObj.searchParams.get('year'), 10);
    if (!year) return ctx.send(400, { error: 'year required' });

    const [rows] = await pool.query(
      'SELECT id, year, version, version_type, status, start_date, end_date, remark, created_by FROM ops_budget_version WHERE year=? ORDER BY version ASC',
      [year]
    );
    ctx.send(200, rows.map(r => ({
      id: r.id, year: r.year, version: r.version, versionType: r.version_type,
      status: r.status, startDate: r.start_date, endDate: r.end_date,
      remark: r.remark, createdBy: r.created_by
    })));
  });

  // POST /api/budget-version - 新建版本
  registerRoute('POST', '/api/budget-version', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const year = parseInt(body.year, 10);
    const version = body.version || 'V1';
    const versionType = body.versionType || 'estimate';
    if (!year || !version) return ctx.send(400, { error: 'year and version required' });

    await pool.query(
      'INSERT INTO ops_budget_version (year, version, version_type, status, remark) VALUES (?,?,?,?,?)',
      [year, version, versionType, 'draft', body.remark || '']
    );
    ctx.send(201, { ok: true });
  });

  // POST /api/budget-version/activate - 激活版本
  registerRoute('POST', '/api/budget-version/activate', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const id = parseInt(body.id, 10);
    if (!id) return ctx.send(400, { error: 'id required' });

    await pool.query("UPDATE ops_budget_version SET status='active' WHERE id=?", [id]);
    ctx.send(200, { ok: true });
  });
};
