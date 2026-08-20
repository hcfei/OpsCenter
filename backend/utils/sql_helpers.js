/* SQL 辅助函数模块 */

/* 构建 IN 查询占位符 */
function buildInClause(values) {
  if (!values || values.length === 0) return 'NULL IN (NULL)';
  return values.map(() => '?').join(',');
}

/* 构建分页查询 */
function buildPaginate(sql, page, pageSize) {
  const offset = (page - 1) * pageSize;
  return `${sql} LIMIT ${parseInt(pageSize, 10)} OFFSET ${parseInt(offset, 10)}`;
}

/* 构建排序 */
function buildOrderBy(orderBy, defaultOrder = 'ASC') {
  if (!orderBy) return '';
  const [field, order] = orderBy.split(':');
  return `ORDER BY ${field} ${order || defaultOrder}`;
}

/* 构建模糊搜索 */
function buildSearch(fields, keyword) {
  if (!keyword) return '';
  const conditions = fields.map(f => `${f} LIKE ?`).join(' OR ');
  const values = fields.map(() => `%${keyword}%`);
  return { condition: `(${conditions})`, values };
}

/* 构建 WHERE 条件 */
function buildWhere(conditions, params = []) {
  if (!conditions || conditions.length === 0) return { sql: '', params };
  const where = conditions.filter(c => c).join(' AND ');
  return { sql: where ? `WHERE ${where}` : '', params };
}

/* 参数化 IN 查询 */
async function queryIn(pool, sql, idField, ids) {
  if (!ids || ids.length === 0) {
    return [[], []];
  }
  const placeholders = ids.map(() => '?').join(',');
  const fullSql = sql.replace(':ids', placeholders);
  return pool.query(fullSql, ids);
}

/* 批量插入 */
async function batchInsert(pool, table, records) {
  if (!records || records.length === 0) return { affectedRows: 0 };

  const keys = Object.keys(records[0]);
  const values = records.map(r => Object.values(r));
  const placeholders = keys.map(() => '?').join(',');
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let affectedRows = 0;
    for (const vals of values) {
      const [result] = await conn.query(sql, vals);
      affectedRows += result.affectedRows;
    }
    await conn.commit();
    return { affectedRows };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/* 解析 JSON 字段（兼容字符串和对象） */
function parseJson(json) {
  if (!json) return null;
  if (typeof json === 'object') return json;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* 序列化 JSON 字段（兼容字符串和对象） */
function stringifyJson(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') return obj;
  return JSON.stringify(obj);
}

module.exports = {
  buildInClause,
  buildPaginate,
  buildOrderBy,
  buildSearch,
  buildWhere,
  queryIn,
  batchInsert,
  parseJson,
  stringifyJson
};
