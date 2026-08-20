/* RBAC 路由模块 - 用户/角色/权限/组织管理
 * API:
 *   GET/POST   /api/admin/users         - 用户管理
 *   GET/POST   /api/admin/roles         - 角色管理
 *   GET/POST   /api/admin/permissions   - 权限管理
 *   GET/POST   /api/admin/orgs         - 组织管理
 *   GET/POST   /api/admin/org-templates  - 组织模板
 */

let registerRoute, getPool, send, readBody;

function budgetLevelOf(depth) {
  const LEVELS = { 1: '集团', 2: 'BG', 3: 'BD', 4: '领域', 5: 'BU' };
  return LEVELS[depth] || '未知';
}

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;

  // GET /api/admin/users - 用户列表
  registerRoute('GET', '/api/admin/users', async (ctx) => {
    const pool = ctx.pool;
    const [rows] = await pool.query(
      'SELECT u.id, u.username, u.nickname, u.email, u.mobile, u.org_id, u.status, u.created_at FROM sys_user u ORDER BY u.id ASC'
    );
    ctx.send(200, rows.map(r => ({
      id: r.id, username: r.username, nickname: r.nickname, email: r.email,
      mobile: r.mobile, orgId: r.org_id, status: r.status, createdAt: r.created_at
    })));
  });

  // POST /api/admin/users - 创建用户
  registerRoute('POST', '/api/admin/users', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const username = body.username;
    const password = body.password || 'Password123';
    if (!username) return ctx.send(400, { error: 'username required' });

    // 生成 salt 和 hash
    const crypto = require('crypto');
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + password).digest('hex');

    const [r] = await pool.query(
      'INSERT INTO sys_user (username, password, salt, nickname, email, mobile, org_id, status) VALUES (?,?,?,?,?,?,?,?)',
      [username, hash, salt, body.nickname || '', body.email || '', body.mobile || '', body.orgId || null, body.status || 1]
    );
    ctx.send(201, { _id: String(r.insertId) });
  });

  // GET /api/admin/roles - 角色列表
  registerRoute('GET', '/api/admin/roles', async (ctx) => {
    const pool = ctx.pool;
    const [rows] = await pool.query('SELECT id, name, code, description FROM sys_role ORDER BY id ASC');
    ctx.send(200, rows.map(r => ({
      id: r.id, name: r.name, code: r.code, description: r.description
    })));
  });

  // POST /api/admin/roles - 创建角色
  registerRoute('POST', '/api/admin/roles', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    if (!body.name || !body.code) return ctx.send(400, { error: 'name and code required' });

    const [r] = await pool.query(
      'INSERT INTO sys_role (name, code, description) VALUES (?,?,?)',
      [body.name, body.code, body.description || '']
    );
    ctx.send(201, { _id: String(r.insertId), id: r.insertId });
  });

  // GET /api/admin/permissions - 权限列表
  registerRoute('GET', '/api/admin/permissions', async (ctx) => {
    const pool = ctx.pool;
    const [rows] = await pool.query('SELECT id, code, name, description FROM sys_permission ORDER BY id ASC');
    ctx.send(200, rows.map(r => ({
      id: r.id, code: r.code, name: r.name, description: r.description
    })));
  });

  // GET /api/admin/org-templates - 组织模板列表
  registerRoute('GET', '/api/admin/org-templates', async (ctx) => {
    const pool = ctx.pool;
    const [rows] = await pool.query('SELECT id, name, levels, remark FROM sys_org_template ORDER BY id ASC');
    ctx.send(200, rows.map(r => ({
      id: r.id, name: r.name, levels: r.levels ? JSON.parse(r.levels) : [], remark: r.remark
    })));
  });

  // POST /api/admin/org-templates - 创建组织模板
  registerRoute('POST', '/api/admin/org-templates', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    if (!body.name) return ctx.send(400, { error: 'name required' });

    const [r] = await pool.query(
      'INSERT INTO sys_org_template (name, levels, remark) VALUES (?,?,?)',
      [body.name, JSON.stringify(body.levels || []), body.remark || '']
    );
    ctx.send(201, { _id: String(r.insertId) });
  });

  // GET /api/admin/orgs - 组织列表
  registerRoute('GET', '/api/admin/orgs', async (ctx) => {
    const pool = ctx.pool;
    const urlObj = new URL(ctx.req.url, 'http://x');
    const parentId = urlObj.searchParams.get('parentId');

    let sql = 'SELECT id, name, parent_id, depth, sort, status, level_name, tpl_level, template_id FROM sys_org WHERE 1=1';
    const params = [];
    if (parentId) { sql += ' AND parent_id=?'; params.push(parseInt(parentId, 10)); }
    sql += ' ORDER BY sort ASC, id ASC';

    const [rows] = await pool.query(sql, params);

    // 获取模板列表
    const [templates] = await pool.query('SELECT id, name, levels FROM sys_org_template');
    const tplMap = {};
    templates.forEach(t => { tplMap[t.id] = t; });

    // 获取每个节点的直接子节点数量
    const [counts] = await pool.query('SELECT parent_id, COUNT(*) as cnt FROM sys_org GROUP BY parent_id');
    const childCountMap = {};
    counts.forEach(c => { childCountMap[c.parent_id] = c.cnt; });

    ctx.send(200, rows.map(r => ({
      id: r.id, name: r.name, parentId: r.parent_id, depth: r.depth,
      sort: r.sort, status: r.status, level: budgetLevelOf(r.depth),
      levelName: r.level_name, tplLevel: r.tpl_level,
      templateId: r.template_id,
      templateName: r.template_id ? tplMap[r.template_id]?.name : null,
      hasChildren: childCountMap[r.id] > 0
    })));
  });

  // POST /api/admin/orgs - 创建组织
  registerRoute('POST', '/api/admin/orgs', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    if (!body.name || !body.parentId) return ctx.send(400, { error: 'name and parentId required' });

    // 获取父节点深度
    const [[parent]] = await pool.query('SELECT depth FROM sys_org WHERE id=?', [body.parentId]);
    const depth = parent ? parent.depth + 1 : 1;

    const [r] = await pool.query(
      'INSERT INTO sys_org (name, parent_id, depth, sort, status, level_name, tpl_level, template_id) VALUES (?,?,?,?,?,?,?,?)',
      [body.name, body.parentId, depth, body.sort || 0, body.status || 1, body.levelName || null, body.tplLevel || null, body.templateId || null]
    );
    ctx.send(201, { _id: String(r.insertId) });
  });
};
