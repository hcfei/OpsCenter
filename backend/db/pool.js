/* 数据库连接池模块 */

const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ops_platform',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool = null;

/* 获取连接池 */
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

/* 关闭连接池 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[db] MySQL 连接池已关闭');
  }
}

/* 执行查询 */
async function query(sql, params) {
  const p = await getPool();
  return p.query(sql, params);
}

/* 执行单条查询 */
async function queryOne(sql, params) {
  const [rows] = await query(sql, params);
  return rows[0] || null;
}

/* 执行插入 */
async function insert(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const [result] = await query(sql, values);
  return result;
}

/* 执行更新 */
async function update(table, data, where) {
  const sets = Object.keys(data).map(k => `${k}=?`).join(',');
  const values = [...Object.values(data), ...Object.values(where)];
  const whereClause = Object.keys(where).map(k => `${k}=?`).join(' AND ');
  const sql = `UPDATE ${table} SET ${sets} WHERE ${whereClause}`;
  const [result] = await query(sql, values);
  return result;
}

/* 执行删除 */
async function remove(table, where) {
  const whereClause = Object.keys(where).map(k => `${k}=?`).join(' AND ');
  const values = Object.values(where);
  const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
  const [result] = await query(sql, values);
  return result;
}

module.exports = {
  getPool,
  closePool,
  query,
  queryOne,
  insert,
  update,
  remove,
  DB_CONFIG
};
