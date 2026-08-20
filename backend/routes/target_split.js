/* 预算目标拆分路由模块
 * API:
 *   GET/POST   /api/target-split      - 目标拆分 CRUD
 *   POST       /api/target-split/batch - 批量导入
 */

let registerRoute, getPool, send, readBody;

function targetRowToApi(row) {
  const api = { _id: String(row.id), 年度: row.year, BU: row.bu };
  api['指标'] = row.metric;
  api['Q1目标'] = row.q1_target;
  api['Q2目标'] = row.q2_target;
  api['Q3目标'] = row.q3_target;
  api['Q4目标'] = row.q4_target;
  if (row.created_at) api['创建时间'] = row.created_at;
  return api;
}

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;

  // GET /api/target-split - 查询目标拆分
  registerRoute('GET', '/api/target-split', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const year = urlObj.searchParams.get('year');

    let sql = 'SELECT * FROM ops_target_split WHERE 1=1';
    const params = [];
    if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
    sql += ' ORDER BY bu ASC, metric ASC';

    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows.map(targetRowToApi));
  });

  // POST /api/target-split - 新增目标拆分
  registerRoute('POST', '/api/target-split', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const db = {
      year: parseInt(body['年度'], 10),
      bu: body['BU'] || '汇总',
      metric: body['指标'] || '',
      q1_target: parseFloat(body['Q1目标']) || 0,
      q2_target: parseFloat(body['Q2目标']) || 0,
      q3_target: parseFloat(body['Q3目标']) || 0,
      q4_target: parseFloat(body['Q4目标']) || 0
    };
    if (!db.year || !db.bu) return ctx.send(400, { error: 'year and bu required' });

    const [r] = await pool.query(
      'INSERT INTO ops_target_split (year, bu, metric, q1_target, q2_target, q3_target, q4_target) VALUES (?,?,?,?,?,?,?)',
      [db.year, db.bu, db.metric, db.q1_target, db.q2_target, db.q3_target, db.q4_target]
    );
    ctx.send(201, { _id: String(r.insertId) });
  });

  // POST /api/target-split/batch - 批量导入
  registerRoute('POST', '/api/target-split/batch', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    if (list.length === 0) return ctx.send(400, { error: 'expected non-empty array' });

    const year = parseInt(list[0]['年度'], 10) || 0;
    if (!year) return ctx.send(400, { error: 'year required' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM ops_target_split WHERE year=?', [year]);

      let count = 0;
      for (const rec of list) {
        await conn.query(
          'INSERT INTO ops_target_split (year, bu, metric, q1_target, q2_target, q3_target, q4_target) VALUES (?,?,?,?,?,?,?)',
          [year, rec['BU'] || '汇总', rec['指标'] || '', parseFloat(rec['Q1目标']) || 0, parseFloat(rec['Q2目标']) || 0, parseFloat(rec['Q3目标']) || 0, parseFloat(rec['Q4目标']) || 0]
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
