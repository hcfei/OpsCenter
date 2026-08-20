/* 经营记录路由模块
 * API:
 *   GET/POST   /api/records        - 经营记录 CRUD
 *   POST       /api/records/batch  - 批量导入
 */

let registerRoute, getPool, send, readBody;

function rowToApi(row) {
  const api = { _id: String(row.id), 年度: row.year, 月份: row.month };
  api['BU'] = row.bu || '汇总';
  const CN_FIELDS = {
    '收入': 'revenue', '成本': 'cost', '毛利': 'gross_profit', '毛利率': 'gross_margin',
    '人力成本': 'headcount_cost', '外包成本': 'outsource_cost', '差旅成本': 'travel_cost',
    '项目数': 'project_count', '在维项目数': 'maintain_project_count',
    '新签项目数': 'new_project_count', '结项项目数': 'closed_project_count'
  };
  Object.entries(CN_FIELDS).forEach(([cn, col]) => {
    api[cn] = row[col] != null ? Number(row[col]) : 0;
  });
  if (row.sign_date) api['签约日期'] = row.sign_date;
  if (row.remark) api['备注'] = row.remark;
  return api;
}

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;

  // GET /api/records - 查询记录
  registerRoute('GET', '/api/records', async (ctx) => {
    const pool = ctx.pool;
    const [rows] = await pool.query('SELECT * FROM ops_records ORDER BY sign_date DESC, id DESC');
    ctx.send(200, rows.map(rowToApi));
  });

  // POST /api/records - 新增记录
  registerRoute('POST', '/api/records', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const db = {
      year: parseInt(body['年度'], 10),
      month: parseInt(body['月份'], 10),
      bu: body['BU'] || '汇总',
      revenue: parseFloat(body['收入']) || 0,
      cost: parseFloat(body['成本']) || 0,
      gross_profit: parseFloat(body['毛利']) || 0,
      headcount_cost: parseFloat(body['人力成本']) || 0,
      outsource_cost: parseFloat(body['外包成本']) || 0,
      travel_cost: parseFloat(body['差旅成本']) || 0,
      project_count: parseInt(body['项目数'], 10) || 0,
      sign_date: body['签约日期'] || null,
      remark: body['备注'] || ''
    };
    if (!db.year || !db.month) return ctx.send(400, { error: 'year and month required' });

    const [r] = await pool.query(
      'INSERT INTO ops_records (year, month, bu, revenue, cost, gross_profit, headcount_cost, outsource_cost, travel_cost, project_count, sign_date, remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [db.year, db.month, db.bu, db.revenue, db.cost, db.gross_profit, db.headcount_cost, db.outsource_cost, db.travel_cost, db.project_count, db.sign_date, db.remark]
    );
    ctx.send(201, { _id: String(r.insertId) });
  });

  // PUT /api/records/:id - 更新记录
  registerRoute('PUT', '/api/records', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const id = parseInt(body['_id'] || body['id'], 10);
    if (!id) return ctx.send(400, { error: 'id required' });

    const fields = {};
    if ('年度' in body) fields.year = parseInt(body['年度'], 10);
    if ('月份' in body) fields.month = parseInt(body['月份'], 10);
    if ('BU' in body) fields.bu = body['BU'];
    if ('收入' in body) fields.revenue = parseFloat(body['收入']) || 0;
    if ('成本' in body) fields.cost = parseFloat(body['成本']) || 0;
    if ('毛利' in body) fields.gross_profit = parseFloat(body['毛利']) || 0;
    if ('人力成本' in body) fields.headcount_cost = parseFloat(body['人力成本']) || 0;
    if ('外包成本' in body) fields.outsource_cost = parseFloat(body['外包成本']) || 0;
    if ('差旅成本' in body) fields.travel_cost = parseFloat(body['差旅成本']) || 0;
    if ('项目数' in body) fields.project_count = parseInt(body['项目数'], 10) || 0;
    if ('签约日期' in body) fields.sign_date = body['签约日期'];
    if ('备注' in body) fields.remark = body['备注'];

    const cols = Object.keys(fields).map(c => c + '=?');
    const vals = Object.values(fields);
    await pool.query(`UPDATE ops_records SET ${cols.join(',')} WHERE id=?`, [...vals, id]);
    ctx.send(200, { ok: true });
  });

  // DELETE /api/records/:id - 删除记录
  registerRoute('DELETE', '/api/records', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const id = parseInt(urlObj.searchParams.get('id'), 10);
    if (!id) return ctx.send(400, { error: 'id required' });

    await pool.query('DELETE FROM ops_records WHERE id=?', [id]);
    ctx.send(200, { ok: true });
  });
};
