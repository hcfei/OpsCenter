/* 数据表元数据路由模块
 * API:
 *   GET/POST   /api/table-meta          - 表元数据 CRUD
 *   GET        /api/table-meta/tree     - 表分类树
 *   POST       /api/table-meta/:id/approve - 审批
 *   POST       /api/table-meta/:id/submit  - 提交审批
 */

let registerRoute, getPool, send, readBody;

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;

  // GET /api/table-meta/tree - 表分类树
  registerRoute('GET', '/api/table-meta/tree', async (ctx) => {
    const pool = ctx.pool;
    const [rows] = await pool.query('SELECT id, name, type, parent_id, table_name, description, status FROM ops_table_meta ORDER BY sort ASC, id ASC');
    ctx.send(200, rows.map(r => ({
      id: r.id, name: r.name, type: r.type, parentId: r.parent_id,
      tableName: r.table_name, description: r.description, status: r.status
    })));
  });

  // POST /api/table-meta - 创建表元数据
  registerRoute('POST', '/api/table-meta', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    if (!body.name || !body.type) return ctx.send(400, { error: 'name and type required' });

    const [r] = await pool.query(
      'INSERT INTO ops_table_meta (name, type, parent_id, table_name, description, status) VALUES (?,?,?,?,?,?)',
      [body.name, body.type, body.parentId || null, body.tableName || '', body.description || '', body.status || 'draft']
    );
    ctx.send(201, { _id: String(r.insertId) });
  });

  // GET /api/table-meta - 表元数据列表
  registerRoute('GET', '/api/table-meta', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const type = urlObj.searchParams.get('type');

    let sql = 'SELECT * FROM ops_table_meta WHERE 1=1';
    const params = [];
    if (type) { sql += ' AND type=?'; params.push(type); }
    sql += ' ORDER BY sort ASC, id ASC';

    const [rows] = await pool.query(sql, params);
    ctx.send(200, rows.map(r => ({
      id: r.id, name: r.name, type: r.type, parentId: r.parent_id,
      tableName: r.table_name, description: r.description, status: r.status
    })));
  });

  // PUT /api/table-meta/:id - 更新表元数据
  registerRoute('PUT', '/api/table-meta', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const id = parseInt(body['_id'] || body['id'], 10);
    if (!id) return ctx.send(400, { error: 'id required' });

    const fields = {};
    if ('name' in body) fields.name = body.name;
    if ('tableName' in body) fields.table_name = body.tableName;
    if ('description' in body) fields.description = body.description;
    if ('status' in body) fields.status = body.status;

    const cols = Object.keys(fields).map(c => c + '=?');
    const vals = Object.values(fields);
    await pool.query(`UPDATE ops_table_meta SET ${cols.join(',')} WHERE id=?`, [...vals, id]);
    ctx.send(200, { ok: true });
  });

  // DELETE /api/table-meta/:id - 删除表元数据
  registerRoute('DELETE', '/api/table-meta', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const id = parseInt(urlObj.searchParams.get('id'), 10);
    if (!id) return ctx.send(400, { error: 'id required' });

    await pool.query('DELETE FROM ops_table_meta WHERE id=?', [id]);
    ctx.send(200, { ok: true });
  });
};
