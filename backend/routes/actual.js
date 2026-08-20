/* 月度实际数据路由模块
 * API:
 *   GET/POST   /api/actual           - 月度实际 CRUD
 *   POST       /api/actual/batch     - 批量导入
 */

let registerRoute, getPool, send, readBody;

function actualRowToApi(row) {
  const api = { _id: String(row.id), 年度: row.year, 月份: row.month, BU: row.bu || '汇总' };
  api['实际收入'] = row.actual_revenue != null ? Number(row.actual_revenue) : 0;
  api['实际利润'] = row.actual_profit != null ? Number(row.actual_profit) : 0;
  api['实际现金流'] = row.actual_cash != null ? Number(row.actual_cash) : 0;
  api['实际费用'] = row.actual_expense != null ? Number(row.actual_expense) : 0;
  if (row.remark) api['备注'] = row.remark;
  if (row.created_at) api['创建时间'] = row.created_at;
  return api;
}

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;

  // GET /api/actual - 查询实际数据
  registerRoute('GET', '/api/actual', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const year = urlObj.searchParams.get('year');
    const bu = urlObj.searchParams.get('bu');
    const month = urlObj.searchParams.get('month');
    const orgId = urlObj.searchParams.get('org_id');

    let sql = 'SELECT * FROM ops_actual WHERE 1=1';
    const params = [];
    if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
    if (bu) { sql += ' AND bu=?'; params.push(String(bu)); }
    if (month) { sql += ' AND month=?'; params.push(parseInt(month, 10)); }
    if (orgId) { sql += ' AND org_id=?'; params.push(parseInt(orgId, 10)); }
    sql += ' ORDER BY year ASC, month ASC';

    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows.map(actualRowToApi));
  });

  // POST /api/actual - 新增实际数据
  registerRoute('POST', '/api/actual', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const db = {
      year: parseInt(body['年度'], 10),
      month: parseInt(body['月份'], 10),
      bu: body['BU'] || '汇总',
      actual_revenue: parseFloat(body['实际收入']) || 0,
      actual_profit: parseFloat(body['实际利润']) || 0,
      actual_cash: parseFloat(body['实际现金流']) || 0,
      actual_expense: parseFloat(body['实际费用']) || 0,
      remark: body['备注'] || ''
    };
    if (!db.year || !db.month) return ctx.send(400, { error: 'year and month required' });
    // 拒绝 bu=汇总（汇总不落库）
    if (db.bu === '汇总') return ctx.send(400, { error: 'bu 汇总不落库，汇总由查询时聚合计算' });

    const [r] = await pool.query(
      'INSERT INTO ops_actual (year, month, bu, actual_revenue, actual_profit, actual_cash, actual_expense, remark) VALUES (?,?,?,?,?,?,?,?)',
      [db.year, db.month, db.bu, db.actual_revenue, db.actual_profit, db.actual_cash, db.actual_expense, db.remark]
    );
    ctx.send(201, { _id: String(r.insertId) });
  });

  // PUT /api/actual/:id - 更新实际数据
  registerRoute('PUT', '/api/actual', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const id = parseInt(body['_id'] || body['id'], 10);
    if (!id) return ctx.send(400, { error: 'id required' });

    const db = {};
    if ('实际收入' in body) db.actual_revenue = parseFloat(body['实际收入']) || 0;
    if ('实际利润' in body) db.actual_profit = parseFloat(body['实际利润']) || 0;
    if ('实际现金流' in body) db.actual_cash = parseFloat(body['实际现金流']) || 0;
    if ('实际费用' in body) db.actual_expense = parseFloat(body['实际费用']) || 0;
    if ('备注' in body) db.remark = body['备注'];

    const cols = Object.keys(db).map(c => c + '=?');
    const vals = Object.values(db);
    await pool.query(`UPDATE ops_actual SET ${cols.join(',')} WHERE id=?`, [...vals, id]);
    ctx.send(200, { ok: true });
  });

  // DELETE /api/actual/:id - 删除实际数据
  registerRoute('DELETE', '/api/actual', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const id = parseInt(urlObj.searchParams.get('id'), 10);
    if (!id) return ctx.send(400, { error: 'id required' });

    await pool.query('DELETE FROM ops_actual WHERE id=?', [id]);
    ctx.send(200, { ok: true });
  });

  // POST /api/actual/batch - 批量导入
  registerRoute('POST', '/api/actual/batch', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    if (list.length === 0) return ctx.send(400, { error: 'expected non-empty array' });

    const year = parseInt(list[0]['年度'], 10) || 0;
    if (!year) return ctx.send(400, { error: 'year required' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM ops_actual WHERE year=?', [year]);

      let count = 0;
      for (const rec of list) {
        const recBu = rec['BU'] || '汇总';
        if (recBu === '汇总') continue; // 跳过汇总
        await conn.query(
          'INSERT INTO ops_actual (year, month, bu, actual_revenue, actual_profit, actual_cash, actual_expense, remark) VALUES (?,?,?,?,?,?,?,?)',
          [year, parseInt(rec['月份'], 10) || 1, recBu, parseFloat(rec['实际收入']) || 0, parseFloat(rec['实际利润']) || 0, parseFloat(rec['实际现金流']) || 0, parseFloat(rec['实际费用']) || 0, rec['备注'] || '']
        );
        count++;
      }
      await conn.commit();
      ctx.send(200, { count, year });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  });
};
