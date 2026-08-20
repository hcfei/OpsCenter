/* 经营预测路由模块
 * API:
 *   GET    /api/forecast/versions    - 版本列表
 *   POST   /api/forecast/batch     - 批量导入
 *   POST   /api/forecast/clone      - 复制版本
 *   DELETE /api/forecast/version    - 删除版本
 *   GET    /api/forecast            - 查询预测
 *   GET    /api/forecast/dept       - 按组织维度查询
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

function fcRowToApi(row) {
  const api = { _id: String(row.id), 年度: row.year, 月份: row.month, BU: row.bu || '汇总' };
  api['预测收入'] = row.forecast_revenue != null ? Number(row.forecast_revenue) : 0;
  api['贡献利润'] = row.contribution_profit != null ? Number(row.contribution_profit) : 0;
  api['现金流'] = row.cash_flow != null ? Number(row.cash_flow) : 0;
  api['费用'] = row.expense != null ? Number(row.expense) : 0;
  api['预测批次'] = row.fc_month;
  api['版本'] = row.version;
  api['org_id'] = row.org_id ? Number(row.org_id) : null;
  if (row.remark) api['备注'] = row.remark;
  return api;
}

async function defaultFcBatch() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT fc_month FROM ops_forecast WHERE fc_month IS NOT NULL ORDER BY fc_month DESC LIMIT 1');
  if (rows.length > 0) return rows[0].fc_month;
  const now = new Date();
  return now.getFullYear() * 100 + (now.getMonth() + 1);
}

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;

  // GET /api/forecast/versions - 版本索引
  registerRoute('GET', '/api/forecast/versions', async (ctx) => {
    const pool = ctx.pool;
    const [rows] = await pool.query(
      'SELECT fc_month, version, year, COUNT(*) AS cnt, MAX(updated_at) AS updated_at FROM ops_forecast WHERE fc_month IS NOT NULL GROUP BY fc_month, version, year ORDER BY fc_month DESC, version ASC, year ASC'
    );
    ctx.send(200, rows.map(r => ({
      fcMonth: r.fc_month, version: r.version, year: r.year, count: r.cnt, updatedAt: r.updated_at
    })));
  });

  // POST /api/forecast/batch - 批量导入
  registerRoute('POST', '/api/forecast/batch', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    if (list.length === 0) return ctx.send(400, { error: 'expected non-empty array' });

    const year = parseInt(list[0]['年度'], 10) || 0;
    const fcMonth = parseInt(list[0]['预测批次'], 10) || await defaultFcBatch();
    const version = (list[0]['版本'] || 'V1');
    if (!year) return ctx.send(400, { error: 'year required' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 清理旧数据
      await conn.query('DELETE FROM ops_forecast WHERE fc_month=? AND version=?', [fcMonth, version]);
      let count = 0;
      for (const rec of list) {
        const db = {
          fc_month: fcMonth, version: version,
          year: parseInt(rec['年度'], 10) || year,
          month: parseInt(rec['月份'], 10) || 1,
          bu: rec['BU'] || '汇总',
          forecast_revenue: parseFloat(rec['预测收入']) || 0,
          contribution_profit: parseFloat(rec['贡献利润']) || 0,
          cash_flow: parseFloat(rec['现金流']) || 0,
          expense: parseFloat(rec['费用']) || 0,
          remark: rec['备注'] || ''
        };
        await conn.query(
          'INSERT INTO ops_forecast (fc_month, version, year, month, bu, forecast_revenue, contribution_profit, cash_flow, expense, remark) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [db.fc_month, db.version, db.year, db.month, db.bu, db.forecast_revenue, db.contribution_profit, db.cash_flow, db.expense, db.remark]
        );
        count++;
      }
      await conn.commit();
      ctx.send(200, { count, fcMonth, version, year });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  });

  // GET /api/forecast/dept - 按组织维度获取预测/预算/实际数据
  registerRoute('GET', '/api/forecast/dept', async (ctx) => {
    const pool = ctx.pool;
    const q = ctx.req.url.includes('?') ? new URL(ctx.req.url, 'http://x') : { searchParams: new Map() };
    const urlObj = new URL(ctx.req.url, 'http://x');
    const year = parseInt(urlObj.searchParams.get('year') || new Date().getFullYear(), 10);
    const fcMonth = parseInt(urlObj.searchParams.get('fcMonth') || urlObj.searchParams.get('fc_month') || '', 10) || 0;
    const version = urlObj.searchParams.get('version') || 'V1';
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

    // 通用数据查询函数（参数化）
    const fetchOrgData = async (tableName, columns, idField, queryParams) => {
      const queryIds = allIds.length === 1 && orgId !== ROOT_ORG_ID ? [...allIds, ROOT_ORG_ID] : allIds;
      const placeholders = queryIds.map(() => '?').join(',');
      const sql = `SELECT ${idField}, month, ${columns.join(', ')} FROM ${tableName} WHERE ${idField} IN (${placeholders}) AND ${queryParams.where}`;
      const [rows] = await pool.query(sql, [...queryIds, ...queryParams.values]);
      const dataMap = {};
      queryIds.forEach(id => { dataMap[id] = {}; });
      rows.forEach(r => {
        if (!dataMap[r[idField]]) dataMap[r[idField]] = {};
        const mKey = r.month + '月';
        dataMap[r[idField]][mKey] = {};
        columns.forEach(col => { dataMap[r[idField]][mKey][col] = Number(r[col]) || 0; });
      });
      return dataMap;
    };

    const actualFcMonth = fcMonth || await defaultFcBatch();
    const forecastByOrg = await fetchOrgData(
      'ops_forecast',
      ['forecast_revenue', 'contribution_profit', 'cash_flow', 'expense'],
      'org_id',
      { where: 'fc_month=? AND version=? AND year=?', values: [actualFcMonth, version, year] }
    );

    const budgetByOrg = await fetchOrgData(
      'ops_budget',
      ['budget_revenue', 'budget_profit', 'budget_cash', 'budget_expense'],
      'org_id',
      { where: 'year=?', values: [year] }
    );

    const actualByOrg = await fetchOrgData(
      'ops_actual',
      ['actual_revenue', 'actual_profit', 'actual_cash', 'actual_expense'],
      'org_id',
      { where: 'year=?', values: [year] }
    );

    // 构建数据
    const buildData = (targetOrgId) => {
      const getOrgAndChildrenIds = (oid) => {
        const result = [oid];
        const findKids = (pid) => {
          allChildren.forEach(c => {
            if (c.parent_id === pid) {
              result.push(c.id);
              findKids(c.id);
            }
          });
        };
        findKids(oid);
        return result;
      };
      const orgIds = getOrgAndChildrenIds(targetOrgId);
      const parentIds = new Set(allChildren.map(c => c.parent_id));
      const leafIds = orgIds.filter(id => !parentIds.has(id));
      const isLeaf = leafIds.includes(targetOrgId) && leafIds.length === 1 && orgIds.length === 1;

      const METRIC_KEYS = [
        'forecast_revenue','forecast_profit','forecast_cash','forecast_expense',
        'budget_revenue','budget_profit','budget_cash','budget_expense',
        'actual_revenue','actual_profit','actual_cash','actual_expense'
      ];
      const SRC_MAP = {
        forecast_revenue: ['forecast','forecast_revenue'], forecast_profit: ['forecast','forecast_profit'],
        forecast_cash: ['forecast','forecast_cash'], forecast_expense: ['forecast','forecast_expense'],
        budget_revenue: ['budget','budget_revenue'], budget_profit: ['budget','budget_profit'],
        budget_cash: ['budget','budget_cash'], budget_expense: ['budget','budget_expense'],
        actual_revenue: ['actual','actual_revenue'], actual_profit: ['actual','actual_profit'],
        actual_cash: ['actual','actual_cash'], actual_expense: ['actual','actual_expense']
      };

      const data = {};
      for (let m = 1; m <= 12; m++) {
        const mKey = m + '月';
        const periodData = {};
        for (const mk of METRIC_KEYS) {
          const [srcPrefix, fieldName] = SRC_MAP[mk];
          const srcMap = srcPrefix === 'forecast' ? forecastByOrg : srcPrefix === 'budget' ? budgetByOrg : actualByOrg;

          let leafSum = 0;
          leafIds.forEach(oid => { leafSum += (srcMap[oid]?.[mKey]?.[fieldName] || 0); });
          let allSum = 0;
          orgIds.forEach(oid => { allSum += (srcMap[oid]?.[mKey]?.[fieldName] || 0); });
          let val = leafSum !== 0 ? leafSum : allSum;

          // BU层级按budget占比分配forecast
          if (isLeaf && srcPrefix === 'forecast' && val === 0) {
            const rootData = forecastByOrg[ROOT_ORG_ID]?.[mKey];
            const rootFcRev = rootData?.forecast_revenue || 0;
            const rootFcProf = rootData?.forecast_profit || 0;
            const rootFcCash = rootData?.forecast_cash || 0;
            const rootFcExp = rootData?.forecast_expense || 0;
            const myBdData = budgetByOrg[targetOrgId]?.[mKey];
            const rootBdData = budgetByOrg[ROOT_ORG_ID]?.[mKey];
            const myBdRev = myBdData?.budget_revenue || 0;
            const rootBdRev = rootBdData?.budget_revenue || 1;
            if (rootFcRev > 0 && myBdRev > 0) {
              const ratio = myBdRev / rootBdRev;
              if (mk === 'forecast_revenue') val = rootFcRev * ratio;
              else if (mk === 'forecast_profit') val = rootFcProf * ratio;
              else if (mk === 'forecast_cash') val = rootFcCash * ratio;
              else if (mk === 'forecast_expense') val = rootFcExp * ratio;
            }
          }
          periodData[mk] = val;
        }
        data[mKey] = periodData;
      }

      // 季度/半年/全年聚合
      const months = [1,2,3,4,5,6,7,8,9,10,11,12];
      const sum = (key, ms) => ms.reduce((s, m) => s + (data[m + '月']?.[key] || 0), 0);
      const Q1 = [1,2,3], Q2 = [4,5,6], Q3 = [7,8,9], Q4 = [10,11,12], H1 = [1,2,3,4,5,6], H2 = [7,8,9,10,11,12];
      data['Q1'] = { forecast_revenue: sum('forecast_revenue', Q1), forecast_profit: sum('forecast_profit', Q1), forecast_cash: sum('forecast_cash', Q1), forecast_expense: sum('forecast_expense', Q1), budget_revenue: sum('budget_revenue', Q1), budget_profit: sum('budget_profit', Q1), budget_cash: sum('budget_cash', Q1), budget_expense: sum('budget_expense', Q1), actual_revenue: sum('actual_revenue', Q1), actual_profit: sum('actual_profit', Q1), actual_cash: sum('actual_cash', Q1), actual_expense: sum('actual_expense', Q1) };
      data['Q2'] = { forecast_revenue: sum('forecast_revenue', Q2), forecast_profit: sum('forecast_profit', Q2), forecast_cash: sum('forecast_cash', Q2), forecast_expense: sum('forecast_expense', Q2), budget_revenue: sum('budget_revenue', Q2), budget_profit: sum('budget_profit', Q2), budget_cash: sum('budget_cash', Q2), budget_expense: sum('budget_expense', Q2), actual_revenue: sum('actual_revenue', Q2), actual_profit: sum('actual_profit', Q2), actual_cash: sum('actual_cash', Q2), actual_expense: sum('actual_expense', Q2) };
      data['Q3'] = { forecast_revenue: sum('forecast_revenue', Q3), forecast_profit: sum('forecast_profit', Q3), forecast_cash: sum('forecast_cash', Q3), forecast_expense: sum('forecast_expense', Q3), budget_revenue: sum('budget_revenue', Q3), budget_profit: sum('budget_profit', Q3), budget_cash: sum('budget_cash', Q3), budget_expense: sum('budget_expense', Q3), actual_revenue: sum('actual_revenue', Q3), actual_profit: sum('actual_profit', Q3), actual_cash: sum('actual_cash', Q3), actual_expense: sum('actual_expense', Q3) };
      data['Q4'] = { forecast_revenue: sum('forecast_revenue', Q4), forecast_profit: sum('forecast_profit', Q4), forecast_cash: sum('forecast_cash', Q4), forecast_expense: sum('forecast_expense', Q4), budget_revenue: sum('budget_revenue', Q4), budget_profit: sum('budget_profit', Q4), budget_cash: sum('budget_cash', Q4), budget_expense: sum('budget_expense', Q4), actual_revenue: sum('actual_revenue', Q4), actual_profit: sum('actual_profit', Q4), actual_cash: sum('actual_cash', Q4), actual_expense: sum('actual_expense', Q4) };
      data['H1'] = { forecast_revenue: sum('forecast_revenue', H1), forecast_profit: sum('forecast_profit', H1), forecast_cash: sum('forecast_cash', H1), forecast_expense: sum('forecast_expense', H1), budget_revenue: sum('budget_revenue', H1), budget_profit: sum('budget_profit', H1), budget_cash: sum('budget_cash', H1), budget_expense: sum('budget_expense', H1), actual_revenue: sum('actual_revenue', H1), actual_profit: sum('actual_profit', H1), actual_cash: sum('actual_cash', H1), actual_expense: sum('actual_expense', H1) };
      data['H2'] = { forecast_revenue: sum('forecast_revenue', H2), forecast_profit: sum('forecast_profit', H2), forecast_cash: sum('forecast_cash', H2), forecast_expense: sum('forecast_expense', H2), budget_revenue: sum('budget_revenue', H2), budget_profit: sum('budget_profit', H2), budget_cash: sum('budget_cash', H2), budget_expense: sum('budget_expense', H2), actual_revenue: sum('actual_revenue', H2), actual_profit: sum('actual_profit', H2), actual_cash: sum('actual_cash', H2), actual_expense: sum('actual_expense', H2) };
      data['全年'] = { forecast_revenue: sum('forecast_revenue', months), forecast_profit: sum('forecast_profit', months), forecast_cash: sum('forecast_cash', months), forecast_expense: sum('forecast_expense', months), budget_revenue: sum('budget_revenue', months), budget_profit: sum('budget_profit', months), budget_cash: sum('budget_cash', months), budget_expense: sum('budget_expense', months), actual_revenue: sum('actual_revenue', months), actual_profit: sum('actual_profit', months), actual_cash: sum('actual_cash', months), actual_expense: sum('actual_expense', months) };

      return data;
    };

    // 直接子部门
    const [directChildren] = await pool.query(
      'SELECT id, name, parent_id, depth FROM sys_org WHERE parent_id=? AND status=1 ORDER BY sort ASC, id ASC',
      [orgId]
    );
    const childList = (directChildren || []).map(c => ({
      id: c.id, name: c.name, level: budgetLevelOf(c.depth), depth: c.depth, data: buildData(c.id)
    }));

    ctx.send(200, {
      year, fcMonth: actualFcMonth, version, orgId,
      periods: BUDGET_PERIODS,
      self: { id: org.id, name: org.name, level: budgetLevelOf(org.depth), depth: org.depth, data: buildData(orgId) },
      children: childList
    });
  });

  // GET /api/forecast - 查询预测
  registerRoute('GET', '/api/forecast', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const fcMonth = parseInt(urlObj.searchParams.get('fcMonth') || urlObj.searchParams.get('fc_month') || '', 10) || 0;
    const version = urlObj.searchParams.get('version');
    const year = urlObj.searchParams.get('year');
    const bu = urlObj.searchParams.get('bu');
    const orgId = urlObj.searchParams.get('org_id');

    let sql = 'SELECT * FROM ops_forecast WHERE 1=1';
    const params = [];
    if (fcMonth) { sql += ' AND fc_month=?'; params.push(fcMonth); }
    if (version) { sql += ' AND version=?'; params.push(String(version)); }
    if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
    if (bu) { sql += ' AND bu=?'; params.push(String(bu)); }
    if (orgId) { sql += ' AND org_id=?'; params.push(parseInt(orgId, 10)); }
    if (!fcMonth) {
      sql += ' AND fc_month=?'; params.push(await defaultFcBatch());
    }
    sql += ' ORDER BY year ASC, month ASC';

    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows.map(fcRowToApi));
  });
};
