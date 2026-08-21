/* 费用包/偏差分析/风险管理路由模块
 * API:
 *   GET/POST   /api/expense/package      - 费用包管理
 *   GET/POST   /api/variance              - 偏差分析
 *   GET/POST   /api/risk                 - 风险管理
 */

let registerRoute, getPool, send, readBody;

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  getPool = ctx.getPool;
  send = ctx.send;
  readBody = ctx.readBody;

  function parseQuery(req) {
    const urlObj = new URL(req.url, 'http://localhost');
    const result = {};
    for (const [key, value] of urlObj.searchParams) {
      result[key] = value;
    }
    return result;
  }

  // ===== 费用包管理 =====

  // GET /api/expense/package - 获取费用包列表
  registerRoute('GET', '/api/expense/package', async (ctx) => {
    const pool = await getPool();
    const query = parseQuery(ctx.req);
    const { orgId, year, quarter } = query;
    let sql = `SELECT p.id, p.org_id, p.expense_type_id, p.year, p.quarter, 
               p.budget_amount, p.used_amount, p.warning_threshold,
               t.name as type_name, t.code as type_code
               FROM ops_expense_package p
               LEFT JOIN ops_expense_type t ON t.id=p.expense_type_id
               WHERE 1=1`;
    const params = [];
    if (orgId) { sql += ' AND p.org_id=?'; params.push(parseInt(orgId, 10)); }
    if (year) { sql += ' AND p.year=?'; params.push(parseInt(year, 10)); }
    if (quarter) { sql += ' AND p.quarter=?'; params.push(parseInt(quarter, 10)); }
    sql += ' ORDER BY p.year DESC, p.quarter, t.sort';
    const [rows] = await pool.query(sql, params);
    // 计算使用率
    rows.forEach(r => {
      r.usage_rate = r.budget_amount > 0 ? (r.used_amount / r.budget_amount * 100).toFixed(1) : '0.0';
      r.is_warning = parseFloat(r.usage_rate) >= parseFloat(r.warning_threshold);
    });
    ctx.send(200, rows);
  });

  // POST /api/expense/package - 保存费用包
  registerRoute('POST', '/api/expense/package', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { orgId, expenseTypeId, year, quarter, budgetAmount, warningThreshold } = body;
    if (!orgId || !expenseTypeId || !year) {
      return ctx.send(400, { error: 'orgId, expenseTypeId, year 不能为空' });
    }
    await pool.query(
      `INSERT INTO ops_expense_package (org_id, expense_type_id, year, quarter, budget_amount, warning_threshold)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE budget_amount=?, warning_threshold=?`,
      [orgId, expenseTypeId, year, quarter || 0, budgetAmount || 0, warningThreshold || 80, budgetAmount || 0, warningThreshold || 80]
    );
    ctx.send(200, { ok: true });
  });

  // 更新费用包使用金额
  registerRoute('POST', '/api/expense/package/used', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { id, usedAmount } = body;
    if (!id) return ctx.send(400, { error: 'id 不能为空' });
    await pool.query('UPDATE ops_expense_package SET used_amount=? WHERE id=?', [usedAmount || 0, id]);
    ctx.send(200, { ok: true });
  });

  // ===== 偏差分析 =====

  // GET /api/variance - 获取偏差列表
  registerRoute('GET', '/api/variance', async (ctx) => {
    const pool = await getPool();
    const query = parseQuery(ctx.req);
    const { orgId, year, month, metric } = query;
    let sql = `SELECT v.id, v.org_id, v.bu, v.year, v.month, v.metric,
               v.forecast_value, v.actual_value, v.variance_value, v.variance_rate, v.reason
               FROM ops_variance v WHERE 1=1`;
    const params = [];
    if (orgId) { sql += ' AND v.org_id=?'; params.push(parseInt(orgId, 10)); }
    if (year) { sql += ' AND v.year=?'; params.push(parseInt(year, 10)); }
    if (month) { sql += ' AND v.month=?'; params.push(parseInt(month, 10)); }
    if (metric) { sql += ' AND v.metric=?'; params.push(metric); }
    sql += ' ORDER BY v.year DESC, v.month DESC';
    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows);
  });

  // POST /api/variance - 保存偏差
  registerRoute('POST', '/api/variance', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { records } = body;
    if (!Array.isArray(records) || records.length === 0) {
      return ctx.send(400, { error: 'records 不能为空' });
    }
    for (const r of records) {
      const { orgId, bu, year, month, metric, forecastValue, actualValue, reason } = r;
      const varianceValue = (forecastValue || 0) - (actualValue || 0);
      const varianceRate = forecastValue > 0 ? (varianceValue / forecastValue * 100).toFixed(1) : '0.0';
      await pool.query(
        `INSERT INTO ops_variance (org_id, bu, year, month, metric, forecast_value, actual_value, variance_value, variance_rate, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE forecast_value=?, actual_value=?, variance_value=?, variance_rate=?, reason=?`,
        [orgId, bu, year, month, metric, forecastValue, actualValue, varianceValue, varianceRate, reason, forecastValue, actualValue, varianceValue, varianceRate, reason]
      );
    }
    ctx.send(200, { ok: true, count: records.length });
  });

  // 自动计算偏差（从预测和实际表）
  registerRoute('POST', '/api/variance/calculate', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { orgId, year, month } = body;
    if (!year || !month) return ctx.send(400, { error: 'year 和 month 不能为空' });

    // 获取预算/预测/实际数据
    const [[budget]] = await pool.query(
      `SELECT SUM(budget_revenue) as rev, SUM(budget_profit) as profit, SUM(budget_expense) as cost 
       FROM ops_budget WHERE year=? AND month=? ${orgId ? 'AND org_id=?' : ''}`,
      orgId ? [year, month, orgId] : [year, month]
    );
    const [[actual]] = await pool.query(
      `SELECT SUM(actual_revenue) as rev, SUM(actual_profit) as profit, SUM(actual_expense) as cost 
       FROM ops_actual WHERE year=? AND month=? ${orgId ? 'AND org_id=?' : ''}`,
      orgId ? [year, month, orgId] : [year, month]
    );

    const metrics = [
      { key: 'revenue', name: '收入', budget: budget.rev || 0, actual: actual.rev || 0 },
      { key: 'profit', name: '贡献利润', budget: budget.profit || 0, actual: actual.profit || 0 },
      { key: 'cost', name: '费用', budget: budget.cost || 0, actual: actual.cost || 0 }
    ];

    for (const m of metrics) {
      const varianceValue = m.budget - m.actual;
      const varianceRate = m.budget > 0 ? (varianceValue / m.budget * 100).toFixed(1) : '0.0';
      await pool.query(
        `INSERT INTO ops_variance (org_id, bu, year, month, metric, forecast_value, actual_value, variance_value, variance_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE forecast_value=?, actual_value=?, variance_value=?, variance_rate=?`,
        [orgId || null, null, year, month, m.key, m.budget, m.actual, varianceValue, varianceRate, m.budget, m.actual, varianceValue, varianceRate]
      );
    }
    ctx.send(200, { ok: true });
  });

  // ===== 风险管理 =====

  // GET /api/risk - 获取风险列表
  registerRoute('GET', '/api/risk', async (ctx) => {
    const pool = await getPool();
    const query = parseQuery(ctx.req);
    const { orgId, status, impactLevel } = query;
    let sql = `SELECT r.id, r.org_id, r.bu, r.risk_desc, r.impact_level, r.measure, r.owner, r.status, r.created_at
               FROM ops_risk r WHERE 1=1`;
    const params = [];
    if (orgId) { sql += ' AND r.org_id=?'; params.push(parseInt(orgId, 10)); }
    if (status) { sql += ' AND r.status=?'; params.push(status); }
    if (impactLevel) { sql += ' AND r.impact_level=?'; params.push(impactLevel); }
    sql += ' ORDER BY r.impact_level DESC, r.created_at DESC';
    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows);
  });

  // POST /api/risk - 新增风险
  registerRoute('POST', '/api/risk', async (ctx) => {
    const pool = await getPool();
    const body = await ctx.readBody();
    const { orgId, bu, riskDesc, impactLevel, measure, owner, status } = body;
    if (!riskDesc) return ctx.send(400, { error: 'riskDesc 不能为空' });
    const [r] = await pool.query(
      `INSERT INTO ops_risk (org_id, bu, risk_desc, impact_level, measure, owner, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orgId || null, bu || null, riskDesc, impactLevel || '中', measure || '', owner || '', status || 'open']
    );
    ctx.send(201, { id: r.insertId });
  });

  // PUT /api/risk/:id - 更新风险
  registerRoute('PUT', '/api/risk/:id', async (ctx) => {
    const pool = await getPool();
    const id = parseInt(ctx.params.id, 10);
    const body = await ctx.readBody();
    const { riskDesc, impactLevel, measure, owner, status } = body;
    await pool.query(
      `UPDATE ops_risk SET risk_desc=?, impact_level=?, measure=?, owner=?, status=? WHERE id=?`,
      [riskDesc, impactLevel, measure, owner, status, id]
    );
    ctx.send(200, { ok: true });
  });

  // DELETE /api/risk/:id - 删除风险
  registerRoute('DELETE', '/api/risk/:id', async (ctx) => {
    const pool = await getPool();
    const id = parseInt(ctx.params.id, 10);
    await pool.query('DELETE FROM ops_risk WHERE id=?', [id]);
    ctx.send(200, { ok: true });
  });
};
