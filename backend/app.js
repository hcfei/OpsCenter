/* 运营管理平台后端服务 - Node.js + MySQL
 * 职责: 提供 REST API (记录增删改查) + 托管静态页面
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { runMigrations } = require('./db/migrations');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '80', 10);

/* ---------- DB 连接配置 (来自 db_config.json) ---------- */
let DB = { host: '127.0.0.1', port: 3306, user: 'ops_app', password: '', database: 'ops_platform' };
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'db_config.json'), 'utf8'));
  DB = Object.assign(DB, cfg);
} catch (e) {
  console.error('[config] db_config.json 缺失，使用默认配置');
}

const DB_CONFIG = {
  host: DB.host,
  port: DB.port,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true
};

// 数据库连接池
let pool;
async function getPool() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
    // 测试连接
    const conn = await pool.getConnection();
    conn.release();
    console.log('[db] MySQL 连接池已创建');
  }
  return pool;
}

// HTTP 响应辅助
function send(res, statusCode, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (res.req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(statusCode);
  res.end(JSON.stringify(data));
}

// 请求体解析
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ===== 路由模块 =====
const routes = [];

/* 注册路由处理函数
 * @param method GET|POST|PUT|DELETE
 * @param pathname API 路径
 * @param handler async function(req, res, {pool, send, readBody, auth}) => void
 */
function registerRoute(method, pathname, handler) {
  routes.push({ method, pathname, handler });
}

// 加载所有路由模块
async function loadRoutes() {
  const path = require('path');
  const fs = require('fs');
  const routesDir = path.join(__dirname, 'routes');

  // 动态加载 routes/ 目录下的所有 .js 文件
  let routeFiles = [];
  try {
    routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
  } catch (e) {
    console.error('[route] 无法读取 routes 目录:', e.message);
  }

  for (const file of routeFiles) {
    try {
      const mod = require(path.join(routesDir, file));
      if (mod && typeof mod.register === 'function') {
        mod.register({ registerRoute, getPool, send, readBody, requireAuth });
        console.log('[route] 已加载:', file);
      }
    } catch (e) {
      console.error('[route] 加载失败:', file, e.message);
    }
  }
}

// ===== 认证中间件 =====
let poolRef;
async function requireAuth(req) {
  if (!poolRef) poolRef = await getPool();
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+([0-9a-f]{64})$/i);
  if (!m) return null;
  const [[row]] = await poolRef.query(
    'SELECT u.id, u.username, u.org_id FROM sys_session s JOIN sys_user u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>NOW()',
    [m[1]]
  );
  return row || null;
}

// ===== 主服务器 =====
const STATIC_EXT = ['.html', '.js', '.css', '.png', '.jpg', '.ico', '.svg'];

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;
  const pathname = url.replace(/^\/api/, '/api'); // 统一前缀

  // 静态文件服务
  if ((method === 'GET' || method === 'HEAD') && !pathname.startsWith('/api/')) {
    const ext = path.extname(pathname);
    if (STATIC_EXT.includes(ext) || pathname === '/') {
      let filePath = pathname === '/' ? '/index.html' : pathname;
      const fullPath = path.join(ROOT, filePath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath);
        // 处理根路径情况：filePath 可能是 /index.html，但 ext 可能是空的
        const actualExt = filePath.includes('.') ? path.extname(filePath) : ext;
        const contentType = actualExt === '.html' ? 'text/html' : actualExt === '.js' ? 'application/javascript' : actualExt === '.css' ? 'text/css' : actualExt === '.png' ? 'image/png' : actualExt === '.jpg' ? 'image/jpeg' : actualExt === '.ico' ? 'image/x-icon' : 'text/html'; // 默认 HTML
        res.writeHead(200, { 'Content-Type': contentType + ';charset=utf-8' });
        res.end(content);
        return;
      }
    }
  }

  try {
    // 认证（除 login/logout/me 外）
    const auth = pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/auth/me'
      ? null
      : await requireAuth(req);

    // 路由分发
    for (const route of routes) {
      if (route.method === method && route.pathname === pathname) {
        const ctx = {
          pool: await getPool(),
          send: (s, d) => send(res, s, d),
          readBody: () => readBody(req),
          auth,
          req, res
        };
        await route.handler(ctx);
        return;
      }
    }

    // 404
    send(res, 404, { error: 'Not Found', path: pathname });
  } catch (e) {
    console.error('[error]', pathname, e.message);
    send(res, 500, { error: e.message });
  }
});

// ===== 启动 =====
async function main() {
  console.log('='.repeat(50));
  console.log('  运营管理平台 (模块化后端)');
  console.log('='.repeat(50));

  // 初始化数据库
  await getPool();

  // 运行迁移
  await runMigrations();

  // 加载路由
  await loadRoutes();

  // 启动服务
  server.listen(PORT, () => {
    console.log(`\n服务已启动: http://localhost:${PORT}/`);
    console.log('按 Ctrl+C 停止\n');
  });
}

main().catch(e => {
  console.error('启动失败:', e);
  process.exit(1);
});
