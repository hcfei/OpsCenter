/* 认证中间件模块 */

const crypto = require('crypto');
const { query, getPool } = require('./pool');

/* 生成 Salt */
function generateSalt() {
  return crypto.randomBytes(8).toString('hex');
}

/* 密码哈希 */
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

/* 验证密码 */
function verifyPassword(password, salt, hash) {
  return hashPassword(password, salt) === hash;
}

/* 创建会话 */
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7天
  await query(
    'INSERT INTO sys_session (user_id, token, expire_at) VALUES (?, ?, ?)',
    [userId, token, expireAt]
  );
  return token;
}

/* 验证会话 */
async function verifySession(token) {
  if (!token) return null;
  const [rows] = await query(
    'SELECT u.id, u.username, u.org_id FROM sys_session s JOIN sys_user u ON u.id=s.user_id WHERE s.token=? AND s.expire_at>NOW()',
    [token]
  );
  return rows[0] || null;
}

/* 删除会话 */
async function deleteSession(token) {
  await query('DELETE FROM sys_session WHERE token=?', [token]);
}

/* 解析 Authorization 头 */
function parseAuthHeader(authHeader) {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+([0-9a-f]{64})$/i);
  return match ? match[1] : null;
}

/* 认证中间件工厂 */
function authMiddleware() {
  return async function(req, res, next) {
    const token = parseAuthHeader(req.headers['authorization']);
    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '未登录或会话已过期' }));
      return;
    }

    const user = await verifySession(token);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '会话已过期' }));
      return;
    }

    req.user = user;
    next();
  };
}

module.exports = {
  generateSalt,
  hashPassword,
  verifyPassword,
  createSession,
  verifySession,
  deleteSession,
  parseAuthHeader,
  authMiddleware
};
