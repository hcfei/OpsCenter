/* 费用管理路由模块
 * API:
 *   GET    /api/expense/types        - 获取费用类型列表
 *   POST   /api/expense/types        - 新建费用类型
 *   PUT    /api/expense/types/:id   - 更新费用类型
 *   DELETE /api/expense/types/:id   - 删除费用类型
 *   GET    /api/expense/budget      - 获取预算(orgId/year/month)
 *   POST   /api/expense/budget      - 批量保存预算
 *   GET    /api/expense/actual      - 获取实际(orgId/year/month)
 *   POST   /api/expense/actual      - 批量保存实际
 *   GET    /api/expense/forecast    - 获取预测
 *   POST   /api/expense/forecast   - 批量保存预测
 *   GET    /api/expense/analysis    - 达成分析(orgId/year)
 */

let registerRoute, getPool, send, readBody;

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  getPool = ctx.getPool;
  send = ctx.send;
  readBody = ctx.readBody;

  // 解析查询参数的辅助函数
  function parseQuery(req) {
    const urlObj = new URL(req.url, 'http://localhost');
    const result = {};
    for (const [key, value] of urlObj.searchParams) {
      result[key] = value;
    }
    return result;
  }

  // ===== 费用类型 =====

  // GET /api/expense/types - 获取费用类型列表
  registerRoute('GET', '/api/expense/types', async (ctx) => {
    const pool = await getPool();
    const [rows] = await pool.query(
      'SELECT id, name, code, parent_id, sort, status FROM ops_expense_type ORDER BY sort, id'
    );
    // 转换为树形结构
    const map = {};
    const roots = [];
    rows.forEach(r => { map[r.id] = { ...r, children: [] }; });
    rows.forEach(r => {
      if (r.parent_id && map[r.parent_id]) {
        map[r.parent_id].children.push(map[r.id]);
      } else {
        roots.push(map[r.id]);
      }
    });
    ctx.send(200, roots);
  });

  // POST /api/expense/types - 新建费用类型
  registerRoute('POST', '/api/expense/types', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { name, code, parentId, sort } = body;
    if (!name || !code) {
      return ctx.send(400, { error: 'name 和 code 不能为空' });
    }
    const [[exist]] = await pool.query('SELECT id FROM ops_expense_type WHERE code=?', [code]);
    if (exist) {
      return ctx.send(400, { error: '类型编码已存在' });
    }
    const [r] = await pool.query(
      'INSERT INTO ops_expense_type (name, code, parent_id, sort, status) VALUES (?, ?, ?, ?, 1)',
      [name, code, parentId || null, sort || 0]
    );
    ctx.send(201, { id: r.insertId });
  });

  // PUT /api/expense/types/:id - 更新费用类型
  registerRoute('PUT', '/api/expense/types/:id', async (ctx) => {
    const pool = await getPool();
    const id = parseInt(ctx.params.id, 10);
    const body = await ctx.readBody();
    const { name, sort, status } = body;
    await pool.query(
      'UPDATE ops_expense_type SET name=?, sort=?, status=? WHERE id=?',
      [name, sort, status, id]
    );
    ctx.send(200, { ok: true });
  });

  // DELETE /api/expense/types/:id - 删除费用类型
  registerRoute('DELETE', '/api/expense/types/:id', async (ctx) => {
    const pool = await getPool();
    const id = parseInt(ctx.params.id, 10);
    // 检查是否有子类型
    const [[child]] = await pool.query('SELECT id FROM ops_expense_type WHERE parent_id=?', [id]);
    if (child) {
      return ctx.send(400, { error: '请先删除子类型' });
    }
    await pool.query('DELETE FROM ops_expense_type WHERE id=?', [id]);
    ctx.send(200, { ok: true });
  });

  // ===== 费用预算 =====

  // GET /api/expense/budget - 获取预算
  registerRoute('GET', '/api/expense/budget', async (ctx) => {
    const pool = await getPool();
    const query = parseQuery(ctx.req);
    const { orgId, year, month } = query;
    let sql = `SELECT b.id, b.org_id, b.expense_type_id, b.year, b.month, b.budget_amount,
               t.name as type_name, t.code as type_code
               FROM ops_expense_budget b
               LEFT JOIN ops_expense_type t ON t.id=b.expense_type_id
               WHERE 1=1`;
    const params = [];
    if (orgId) { sql += ' AND b.org_id=?'; params.push(parseInt(orgId, 10)); }
    if (year) { sql += ' AND b.year=?'; params.push(parseInt(year, 10)); }
    if (month) { sql += ' AND b.month=?'; params.push(parseInt(month, 10)); }
    sql += ' ORDER BY b.year, b.month, t.sort';
    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows);
  });

  // POST /api/expense/budget - 批量保存预算
  registerRoute('POST', '/api/expense/budget', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { records } = body;
    if (!Array.isArray(records) || records.length === 0) {
      return ctx.send(400, { error: 'records 不能为空' });
    }
    for (const r of records) {
      const { orgId, expenseTypeId, year, month, budgetAmount } = r;
      await pool.query(
        `INSERT INTO ops_expense_budget (org_id, expense_type_id, year, month, budget_amount)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE budget_amount=?`,
        [orgId, expenseTypeId, year, month, budgetAmount, budgetAmount]
      );
    }
    ctx.send(200, { ok: true, count: records.length });
  });

  // ===== 费用实际 =====

  // GET /api/expense/actual - 获取实际
  registerRoute('GET', '/api/expense/actual', async (ctx) => {
    const pool = await getPool();
    const query = parseQuery(ctx.req);
    const { orgId, year, month } = query;
    let sql = `SELECT a.id, a.org_id, a.expense_type_id, a.year, a.month, a.actual_amount, a.remark,
               t.name as type_name, t.code as type_code
               FROM ops_expense_actual a
               LEFT JOIN ops_expense_type t ON t.id=a.expense_type_id
               WHERE 1=1`;
    const params = [];
    if (orgId) { sql += ' AND a.org_id=?'; params.push(parseInt(orgId, 10)); }
    if (year) { sql += ' AND a.year=?'; params.push(parseInt(year, 10)); }
    if (month) { sql += ' AND a.month=?'; params.push(parseInt(month, 10)); }
    sql += ' ORDER BY a.year, a.month, t.sort';
    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows);
  });

  // POST /api/expense/actual - 批量保存实际
  registerRoute('POST', '/api/expense/actual', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { records } = body;
    if (!Array.isArray(records) || records.length === 0) {
      return ctx.send(400, { error: 'records 不能为空' });
    }
    for (const r of records) {
      const { orgId, expenseTypeId, year, month, actualAmount, remark } = r;
      await pool.query(
        `INSERT INTO ops_expense_actual (org_id, expense_type_id, year, month, actual_amount, remark)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE actual_amount=?, remark=?`,
        [orgId, expenseTypeId, year, month, actualAmount, remark, actualAmount, remark]
      );
    }
    ctx.send(200, { ok: true, count: records.length });
  });

  // ===== 费用预测 =====

  // GET /api/expense/forecast - 获取预测
  registerRoute('GET', '/api/expense/forecast', async (ctx) => {
    const pool = await getPool();
    const query = parseQuery(ctx.req);
    const { orgId, year, fcMonth, version } = query;
    let sql = `SELECT f.id, f.org_id, f.expense_type_id, f.year, f.month, f.forecast_amount,
               f.fc_month, f.version,
               t.name as type_name, t.code as type_code
               FROM ops_expense_forecast f
               LEFT JOIN ops_expense_type t ON t.id=f.expense_type_id
               WHERE 1=1`;
    const params = [];
    if (orgId) { sql += ' AND f.org_id=?'; params.push(parseInt(orgId, 10)); }
    if (year) { sql += ' AND f.year=?'; params.push(parseInt(year, 10)); }
    if (fcMonth) { sql += ' AND f.fc_month=?'; params.push(fcMonth); }
    if (version) { sql += ' AND f.version=?'; params.push(version); }
    sql += ' ORDER BY f.year, f.month, t.sort';
    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows);
  });

  // POST /api/expense/forecast - 批量保存预测
  registerRoute('POST', '/api/expense/forecast', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { records, fcMonth, version } = body;
    if (!Array.isArray(records) || records.length === 0) {
      return ctx.send(400, { error: 'records 不能为空' });
    }
    for (const r of records) {
      const { orgId, expenseTypeId, year, month, forecastAmount } = r;
      await pool.query(
        `INSERT INTO ops_expense_forecast (org_id, expense_type_id, year, month, forecast_amount, fc_month, version)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE forecast_amount=?`,
        [orgId, expenseTypeId, year, month, forecastAmount, fcMonth, version, forecastAmount]
      );
    }
    ctx.send(200, { ok: true, count: records.length });
  });

  // ===== 费用分析 =====

  // GET /api/expense/analysis - 达成分析
  registerRoute('GET', '/api/expense/analysis', async (ctx) => {
    const pool = await getPool();
    const query = parseQuery(ctx.req);
    const { orgId, year, month } = query;
    if (!orgId || !year) {
      return ctx.send(400, { error: 'orgId 和 year 不能为空' });
    }

    // 获取费用类型
    const [types] = await pool.query(
      'SELECT id, name, code FROM ops_expense_type WHERE status=1 ORDER BY sort'
    );

    // 月度数据
    let monthlySql = `
      SELECT b.expense_type_id, b.month,
             COALESCE(b.budget_amount, 0) as budget,
             COALESCE(a.actual_amount, 0) as actual
      FROM ops_expense_budget b
      LEFT JOIN ops_expense_actual a ON a.org_id=b.org_id AND a.expense_type_id=b.expense_type_id
        AND a.year=b.year AND a.month=b.month
      WHERE b.org_id=? AND b.year=?`;
    const params = [parseInt(orgId, 10), parseInt(year, 10)];
    if (month) { monthlySql += ' AND b.month=?'; params.push(parseInt(month, 10)); }
    monthlySql += ' ORDER BY b.month';
    const [monthly] = await pool.query(monthlySql, params);

    // 按类型汇总
    const typeAgg = {};
    types.forEach(t => {
      typeAgg[t.id] = { ...t, budget: 0, actual: 0 };
    });
    monthly.forEach(m => {
      if (typeAgg[m.expense_type_id]) {
        typeAgg[m.expense_type_id].budget += parseFloat(m.budget);
        typeAgg[m.expense_type_id].actual += parseFloat(m.actual);
      }
    });

    // 全年汇总
    let totalBudget = 0, totalActual = 0;
    monthly.forEach(m => {
      totalBudget += parseFloat(m.budget);
      totalActual += parseFloat(m.actual);
    });

    const typeData = Object.values(typeAgg).map(t => ({
      typeId: t.id,
      typeName: t.name,
      typeCode: t.code,
      budget: t.budget,
      actual: t.actual,
      rate: t.budget > 0 ? (t.actual / t.budget * 100).toFixed(1) : '0.0'
    }));

    ctx.send(200, {
      year: parseInt(year),
      month: month ? parseInt(month) : null,
      totalBudget,
      totalActual,
      totalRate: totalBudget > 0 ? (totalActual / totalBudget * 100).toFixed(1) : '0.0',
      byType: typeData,
      monthly
    });
  });
};
