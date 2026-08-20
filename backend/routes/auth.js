/* 认证路由模块
 * API:
 *   POST   /api/auth/login     - 登录
 *   POST   /api/auth/logout    - 登出
 *   GET    /api/auth/me        - 当前用户信息
 */

let registerRoute, getPool, send, readBody;
let requireAuth;

const crypto = require('crypto');

exports.register = function(ctx) {
  registerRoute = ctx.registerRoute;
  send = ctx.send;
  readBody = ctx.readBody;
  getPool = ctx.getPool;
  requireAuth = ctx.requireAuth;

  // POST /api/auth/login - 登录
  registerRoute('POST', '/api/auth/login', async (ctx) => {
    const pool = ctx.pool;
    const body = await ctx.readBody();
    const username = body.username;
    const password = body.password;
    if (!username || !password) {
      return ctx.send(400, { error: 'username and password required' });
    }

    // 查询用户（兼容无 nickname 列的情况）
    const [[user]] = await pool.query(
      'SELECT id, username, password, salt, org_id FROM sys_user WHERE username=? AND status=1',
      [username]
    );
    if (!user) {
      return ctx.send(401, { error: '用户名或密码错误' });
    }

    // 验证密码（原代码使用 salt + ':' + password）
    const hash = crypto.createHash('sha256').update(user.salt + ':' + password).digest('hex');
    if (hash !== user.password) {
      return ctx.send(401, { error: '用户名或密码错误' });
    }

    // 创建会话（原表使用 expires_at 带 s）
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7天
    await pool.query(
      'INSERT INTO sys_session (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, token, expiresAt]
    );

    // 返回权限
    const [perms] = await pool.query(
      'SELECT p.code FROM sys_permission p JOIN sys_role_permission rp ON rp.permission_id=p.id JOIN sys_user_role ur ON ur.role_id=rp.role_id WHERE ur.user_id=?',
      [user.id]
    );
    const [roles] = await pool.query(
      'SELECT r.code FROM sys_role r JOIN sys_user_role ur ON ur.role_id=r.id WHERE ur.user_id=?',
      [user.id]
    );

    ctx.send(200, {
      token,
      user: { id: user.id, username: user.username, orgId: user.org_id },
      roles: roles.map(r => r.code),
      perms: perms.map(p => p.code)
    });
  });

  // POST /api/auth/logout - 登出
  registerRoute('POST', '/api/auth/logout', async (ctx) => {
    const h = ctx.req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+([0-9a-f]{64})$/i);
    if (m) {
      await ctx.pool.query('DELETE FROM sys_session WHERE token=?', [m[1]]).catch(() => {});
    }
    ctx.send(200, { ok: true });
  });

  // GET /api/auth/me - 当前用户
  registerRoute('GET', '/api/auth/me', async (ctx) => {
    const auth = await requireAuth(ctx.req);
    if (!auth) return ctx.send(401, { error: '未登录或会话已过期' });

    const pool = ctx.pool;
    const [roles] = await pool.query(
      'SELECT r.code FROM sys_role r JOIN sys_user_role ur ON ur.role_id=r.id WHERE ur.user_id=?',
      [auth.id]
    );
    const [perms] = await pool.query(
      'SELECT p.code FROM sys_permission p JOIN sys_role_permission rp ON rp.permission_id=p.id JOIN sys_user_role ur ON ur.role_id=rp.role_id WHERE ur.user_id=?',
      [auth.id]
    );

    ctx.send(200, {
      user: { id: auth.id, username: auth.username, orgId: auth.org_id },
      roles: roles.map(r => r.code),
      perms: perms.map(p => p.code)
    });
  });
};
