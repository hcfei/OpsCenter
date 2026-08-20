#!/usr/bin/env node
'use strict';
/* 运营管理平台后端服务 - Node.js + MySQL
 * 职责: 提供 REST API (记录增删改查) + 托管静态页面
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '80', 10);

/* ---------- DB 连接配置 (来自 db_config.json) ---------- */
let DB = { host: '127.0.0.1', port: 3306, user: 'ops_app', password: '', database: 'ops_platform' };
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'db_config.json'), 'utf8'));
  DB = Object.assign(DB, cfg);
} catch (e) {
  console.error('[config] db_config.json 缺失，使用默认配置 (密码为空，可能连不上)');
}

const pool = mysql.createPool(Object.assign({}, DB, {
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true   // DATE/DATETIME 以 'YYYY-MM-DD' 字符串返回, 避免时区/Date 转换问题
}));

/* ---------- 字段映射: 前端中文 key <-> 数据库英文列 ---------- */
const FIELD_PAIRS = [
  ['合同编号', 'contract_no'], ['项目名称', 'project_name'], ['客户名称', 'customer'],
  ['合同金额', 'contract_amount'], ['合同状态', 'contract_status'], ['签订日期', 'sign_date'],
  ['项目状态', 'project_status'], ['项目负责人', 'owner'], ['项目开始日期', 'project_start'],
  ['项目截止日期', 'project_end'], ['验收状态', 'accept_status'], ['计划验收日期', 'plan_accept_date'],
  ['实际验收日期', 'actual_accept_date'], ['回款金额', 'payment_amount'], ['回款状态', 'payment_status'],
  ['计划回款日期', 'plan_payment_date'], ['备注', 'remark']
];
const CN2COL = {};
const COL2CN = {};
FIELD_PAIRS.forEach(p => { CN2COL[p[0]] = p[1]; COL2CN[p[1]] = p[0]; });
const MONEY_COLS = new Set(['contract_amount', 'payment_amount']);
const DATE_COLS = new Set(['sign_date', 'project_start', 'project_end', 'plan_accept_date', 'actual_accept_date', 'plan_payment_date']);

/* ---------- BU 维度常量: 汇总 + 4 个 BU (与 ops_target_split 口径一致) ---------- */
const BU_LIST = ['汇总', '软工', '硬工', '云', '智能汽车'];

/* ---------- 经营预测字段映射 (前端中文 key <-> 数据库英文列) ---------- */
const FC_FIELD_PAIRS = [
  ['年度', 'year'], ['月份', 'month'], ['BU', 'bu'], ['预测收入', 'forecast_revenue'],
  ['贡献利润', 'contribution_profit'], ['现金流', 'cash_flow'], ['费用', 'expense'], ['备注', 'remark']
];
const FC_CN2COL = {};
const FC_COL2CN = {};
FC_FIELD_PAIRS.forEach(p => { FC_CN2COL[p[0]] = p[1]; FC_COL2CN[p[1]] = p[0]; });
const FC_MONEY_COLS = new Set(['forecast_revenue', 'contribution_profit', 'cash_flow', 'expense']);

/* ---------- 月度预算字段映射 (前端中文 key <-> 数据库英文列) ---------- */
const BUDGET_FIELD_PAIRS = [
  ['年度', 'year'], ['月份', 'month'], ['BU', 'bu'], ['预算收入', 'budget_revenue'], ['预算贡献利润', 'budget_profit'],
  ['预算现金流', 'budget_cash'], ['预算费用', 'budget_expense']
];
const BUDGET_CN2COL = {};
const BUDGET_COL2CN = {};
BUDGET_FIELD_PAIRS.forEach(p => { BUDGET_CN2COL[p[0]] = p[1]; BUDGET_COL2CN[p[1]] = p[0]; });
const BUDGET_MONEY_COLS = new Set(['budget_revenue', 'budget_profit', 'budget_cash', 'budget_expense']);

/* ---------- 月度实际数据字段映射 (经营看板"实际达成", 按月+BU 录入) ----------
 * 汇总口径 = 各 BU 之和 (查询时自动 SUM), 本表不存「汇总」行 */
const ACTUAL_FIELD_PAIRS = [
  ['年度', 'year'], ['月份', 'month'], ['BU', 'bu'], ['实际收入', 'actual_revenue'],
  ['实际贡献利润', 'actual_profit'], ['实际现金流', 'actual_cash'], ['实际费用', 'actual_expense'], ['备注', 'remark']
];
const ACTUAL_CN2COL = {};
const ACTUAL_COL2CN = {};
ACTUAL_FIELD_PAIRS.forEach(p => { ACTUAL_CN2COL[p[0]] = p[1]; ACTUAL_COL2CN[p[1]] = p[0]; });
const ACTUAL_MONEY_COLS = new Set(['actual_revenue', 'actual_profit', 'actual_cash', 'actual_expense']);

/* ---------- 预算目标拆分字段映射 (前端中文 key <-> 数据库英文列) ----------
 * 对应《预测结果模板.xlsx》「预算目标拆分」Sheet:
 *   3 指标(收入/贡献利润/现金流) × 5 BU(软工/硬工/云/智能汽车/汇总)
 *   实际值(7月) 7 列 + 2026年目标-V1 7 列; 偏差与达成率由前端计算, 不入库
 */
const TARGET_FIELD_PAIRS = [
  ['指标', 'metric'], ['BU', 'bu'],
  ['Q1实际', 'q1_act'], ['Q2实际', 'q2_act'], ['Q3实际', 'q3_act'], ['Q4实际', 'q4_act'],
  ['H1实际', 'h1_act'], ['H2实际', 'h2_act'], ['YTD实际', 'ytd_act'],
  ['Q1目标', 'q1_tgt'], ['Q2目标', 'q2_tgt'], ['Q3目标', 'q3_tgt'], ['Q4目标', 'q4_tgt'],
  ['H1目标', 'h1_tgt'], ['H2目标', 'h2_tgt'], ['YTD目标', 'ytd_tgt']
];
const TARGET_CN2COL = {};
const TARGET_COL2CN = {};
TARGET_FIELD_PAIRS.forEach(p => { TARGET_CN2COL[p[0]] = p[1]; TARGET_COL2CN[p[1]] = p[0]; });
const TARGET_MONEY_COLS = new Set([
  'q1_act', 'q2_act', 'q3_act', 'q4_act', 'h1_act', 'h2_act', 'ytd_act',
  'q1_tgt', 'q2_tgt', 'q3_tgt', 'q4_tgt', 'h1_tgt', 'h2_tgt', 'ytd_tgt'
]);

/* ---------- 系统管理表: 用户/角色/权限/组织结构/会话 (RBAC) ---------- */
const CREATE_SYS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sys_user (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  password VARCHAR(64) NOT NULL,
  salt VARCHAR(16) NOT NULL,
  real_name VARCHAR(50) DEFAULT '',
  email VARCHAR(100) DEFAULT '',
  phone VARCHAR(20) DEFAULT '',
  org_id INT DEFAULT NULL,
  status TINYINT DEFAULT 1 COMMENT '1启用 0禁用',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_role (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  code VARCHAR(50) NOT NULL,
  description VARCHAR(200) DEFAULT '',
  status TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_role_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_permission (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  code VARCHAR(100) NOT NULL,
  type VARCHAR(20) DEFAULT 'menu' COMMENT 'menu/button',
  parent_id INT DEFAULT NULL,
  sort INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_perm_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_role_permission (
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (role_id, permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_org (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id INT DEFAULT NULL,
  type VARCHAR(20) DEFAULT 'dept' COMMENT 'company/dept/team',
  sort INT DEFAULT 0,
  status TINYINT DEFAULT 1,
  template_id INT DEFAULT NULL COMMENT '分支模板ID(BD节点挂载)',
  level_name VARCHAR(50) DEFAULT NULL COMMENT '层级名覆盖',
  tpl_level INT DEFAULT NULL COMMENT '模板层级下标(0起,NULL=按深度自动推导)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_org_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cfg_key VARCHAR(50) NOT NULL,
  cfg_value VARCHAR(500) NOT NULL,
  description VARCHAR(200) DEFAULT '',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cfg_key (cfg_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_org_template (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  levels JSON NOT NULL COMMENT '分支层级名数组(BD以下)',
  description VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tpl_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sys_session (
  token VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  KEY idx_session_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/* ---------- 系统管理种子数据: 初始管理员/角色/权限/组织 ---------- */
const SYS_PERMS = [
  ['经营看板', 'dashboard:view', 'menu', null, 1],
  ['经营预测', 'forecast:view', 'menu', null, 2],
  ['预测录入', 'forecast:write', 'button', null, 3],
  ['运营看板', 'opsboard:view', 'menu', null, 4],
  ['运营指标', 'ops:view', 'menu', null, 5],
  ['数据表管理', 'tablemeta:view', 'menu', null, 6],
  ['数据表审批', 'tablemeta:approve', 'button', null, 7],
  ['数据工具', 'data:view', 'menu', null, 8],
  ['后台管理', 'system:admin', 'menu', null, 9]
];
const SYS_ORGS = [
  ['运营管理平台', 'company', null, 1],
  ['经营管理部', 'dept', 1, 1],
  ['项目管理部', 'dept', 1, 2],
  ['数据平台部', 'dept', 1, 3],
  ['综合管理部', 'dept', 1, 4]
];

/* ---------- 组织模型: 固定三层(全局统一) + 分支模板(BD以下, 各部门自选) ---------- */
const ORG_FIXED_LEVELS = ['集团', 'BG', 'BD'];
const ORG_TEMPLATE_SEEDS = [
  ['互联网型', ['领域', 'BU', 'PDU', '项目组'], '互联网业务线：BD→领域→BU→PDU→项目组'],
  ['云业务型', ['CU', 'PDU'], '云业务线：BD→CU→PDU'],
  ['职能型', ['部门', '团队'], '职能支撑：BD→部门→团队'],
  ['硬件型', ['产品线', '产品组'], '硬件产品线：BD→产品线→产品组']
];

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_no VARCHAR(100),
  project_name VARCHAR(200),
  customer VARCHAR(200),
  contract_amount DECIMAL(14,2) DEFAULT 0,
  contract_status VARCHAR(50),
  sign_date DATE,
  project_status VARCHAR(50),
  owner VARCHAR(100),
  project_start DATE,
  project_end DATE,
  accept_status VARCHAR(50),
  plan_accept_date DATE,
  actual_accept_date DATE,
  payment_amount DECIMAL(14,2) DEFAULT 0,
  payment_status VARCHAR(50),
  plan_payment_date DATE,
  remark TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sign_date (sign_date),
  KEY idx_contract_status (contract_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 经营预测表: 按月存储预测数据
 * 滚动预测模型: fc_month=预测批次月份(如 202608=2026年8月做的预测), version=批次内版本(V1/V2/...)
 * BU 维度: bu=汇总/软工/硬工/云/智能汽车, 每次预测覆盖全年 (year+month 12 条), 同批次可多版本;
 * (fc_month, version, bu, year, month) 唯一 */
const CREATE_FC_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_forecast (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fc_month INT NULL COMMENT '预测批次月份 YYYYMM',
  version VARCHAR(10) NULL COMMENT '批次内版本 V1/V2/...',
  bu VARCHAR(20) NOT NULL DEFAULT '汇总' COMMENT 'BU 维度: 汇总/软工/硬工/云/智能汽车',
  year INT NOT NULL,
  month INT NOT NULL,
  forecast_revenue DECIMAL(14,2) DEFAULT 0,
  contribution_profit DECIMAL(14,2) DEFAULT 0,
  cash_flow DECIMAL(14,2) DEFAULT 0,
  expense DECIMAL(14,2) DEFAULT 0,
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_fc_ver_ym_bu (fc_month, version, bu, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 经营预测表结构迁移 (旧版: 批次+版本+年月唯一 -> 新版: 批次+版本+BU+年月唯一):
 * 1. 补 fc_month / version 列 (存量归入当前月份批次 V1) [旧迁移]
 * 2. 补 bu 列, 存量数据归入「汇总」
 * 3. 唯一键升级为 uk_fc_ver_ym_bu */
async function migrateForecastTable() {
  const [cols] = await pool.query("SHOW COLUMNS FROM ops_forecast LIKE 'fc_month'");
  if (cols.length === 0) {
    await pool.query('ALTER TABLE ops_forecast ADD COLUMN fc_month INT NULL AFTER id, ADD COLUMN version VARCHAR(10) NULL AFTER fc_month');
    const now = new Date();
    const ym = now.getFullYear() * 100 + (now.getMonth() + 1);
    await pool.query("UPDATE ops_forecast SET fc_month=?, version='V1' WHERE fc_month IS NULL", [ym]);
    console.log('[migrate] ops_forecast 已升级: 新增 fc_month(预测批次)/version(版本), 存量数据归入 ' + ym + ' 批次 V1');
  }
  const [bucols] = await pool.query("SHOW COLUMNS FROM ops_forecast LIKE 'bu'");
  if (bucols.length === 0) {
    await pool.query("ALTER TABLE ops_forecast ADD COLUMN bu VARCHAR(20) NOT NULL DEFAULT '汇总' AFTER version");
    console.log('[migrate] ops_forecast 已升级: 新增 bu(BU维度), 存量数据归入「汇总」');
  }
  const [idx] = await pool.query("SHOW INDEX FROM ops_forecast WHERE Key_name='uk_fc_ver_ym_bu'");
  if (idx.length === 0) {
    try { await pool.query('ALTER TABLE ops_forecast DROP INDEX uk_fc_ver_ym'); } catch (e) { /* 旧索引不存在则跳过 */ }
    try { await pool.query('ALTER TABLE ops_forecast DROP INDEX uk_year_month'); } catch (e) { /* 旧索引不存在则跳过 */ }
    await pool.query('ALTER TABLE ops_forecast ADD UNIQUE KEY uk_fc_ver_ym_bu (fc_month, version, bu, year, month)');
    console.log('[migrate] ops_forecast 唯一键升级: (fc_month, version, bu, year, month)');
  }
}

/* 默认预测批次: 取最新批次, 无数据时取当前月份 */
async function defaultFcBatch() {
  const [rows] = await pool.query('SELECT fc_month FROM ops_forecast WHERE fc_month IS NOT NULL ORDER BY fc_month DESC LIMIT 1');
  if (rows.length > 0) return rows[0].fc_month;
  const now = new Date();
  return now.getFullYear() * 100 + (now.getMonth() + 1);
}

/* 月度预算表: 每年每 BU 12 条 (year+month+bu 唯一), 季度/半年度/全年由月度聚合 */
const CREATE_BUDGET_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_budget (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  bu VARCHAR(20) NOT NULL DEFAULT '汇总' COMMENT 'BU 维度: 汇总/软工/硬工/云/智能汽车',
  budget_revenue DECIMAL(14,2) DEFAULT 0,
  budget_profit DECIMAL(14,2) DEFAULT 0,
  budget_cash DECIMAL(14,2) DEFAULT 0,
  budget_expense DECIMAL(14,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_year_month_bu (year, month, bu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 月度预算表结构迁移: 补 bu 列(存量归入「汇总」), 唯一键升级为 (year, month, bu) */
async function migrateBudgetTable() {
  const [bucols] = await pool.query("SHOW COLUMNS FROM ops_budget LIKE 'bu'");
  if (bucols.length === 0) {
    await pool.query("ALTER TABLE ops_budget ADD COLUMN bu VARCHAR(20) NOT NULL DEFAULT '汇总' AFTER month");
    console.log('[migrate] ops_budget 已升级: 新增 bu(BU维度), 存量数据归入「汇总」');
  }
  const [idx] = await pool.query("SHOW INDEX FROM ops_budget WHERE Key_name='uk_year_month_bu'");
  if (idx.length === 0) {
    try { await pool.query('ALTER TABLE ops_budget DROP INDEX uk_year_month'); } catch (e) { /* 旧索引不存在则跳过 */ }
    await pool.query('ALTER TABLE ops_budget ADD UNIQUE KEY uk_year_month_bu (year, month, bu)');
    console.log('[migrate] ops_budget 唯一键升级: (year, month, bu)');
  }
}

/* 预算流程表迁移: 补 version 列 */
async function migrateBudgetFlowTable() {
  const [vcols] = await pool.query("SHOW COLUMNS FROM ops_budget_flow LIKE 'version'");
  if (vcols.length === 0) {
    await pool.query("ALTER TABLE ops_budget_flow ADD COLUMN version VARCHAR(20) NOT NULL DEFAULT 'V1' AFTER year");
    console.log('[migrate] ops_budget_flow 已升级: 新增 version 列');
  }
}

async function migrateBudgetVersionTable() {
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS ops_budget_version (" +
      "id INT AUTO_INCREMENT PRIMARY KEY, year INT NOT NULL, version VARCHAR(20) NOT NULL, " +
      "version_type VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'draft', " +
      "start_date DATE, end_date DATE, remark VARCHAR(500), created_by INT, " +
      "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
      "UNIQUE KEY uk_version_year_type (year, version, version_type)" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    console.log('[migrate] ops_budget_version 表已创建/升级');
  } catch (e) { if (e.code !== 'ER_TABLE_EXISTS_ERROR') console.error('[migrate] ops_budget_version:', e.message); }
}

/* 月度实际数据表: 按月+BU 存储"实际达成" (收入/贡献利润/现金流/费用)
 * 汇总口径 = 各 BU 之和 (查询时 SUM), 本表不存「汇总」行 */
const CREATE_ACTUAL_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_actual (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bu VARCHAR(20) NOT NULL DEFAULT '软工' COMMENT 'BU 维度: 软工/硬工/云/智能汽车',
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  actual_revenue DECIMAL(14,2) DEFAULT 0,
  actual_profit DECIMAL(14,2) DEFAULT 0,
  actual_cash DECIMAL(14,2) DEFAULT 0,
  actual_expense DECIMAL(14,2) DEFAULT 0,
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_actual_bu_ym (bu, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* ---------- 预算流程管理: BD→领域→BU 三级预算编制 ----------
 * ops_budget_flow: 预算编制状态（草稿/已提交/已审批/待确认）
 * ops_budget_relation: 上下级汇总关系（BD→领域→BU）
 * ops_budget_allocation: 上级分解到下级的目标比例 */
const CREATE_BUDGET_FLOW_SQL = `
CREATE TABLE IF NOT EXISTS ops_budget_flow (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT 'V1' COMMENT '预算版本如V1/V2/正式版',
  period VARCHAR(10) NOT NULL COMMENT 'Q1/Q2/Q3/Q4/H1/H2/YTD',
  org_id INT NOT NULL COMMENT '组织ID(对应sys_org)',
  level VARCHAR(10) NOT NULL COMMENT 'BD/领域/BU',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft/submitted/approved/rejected/allocated',
  source VARCHAR(20) NOT NULL DEFAULT 'manual' COMMENT 'manual=手工/collected=下级汇总/allocated=上级分解',
  budget_revenue DECIMAL(14,2) DEFAULT 0,
  budget_profit DECIMAL(14,2) DEFAULT 0,
  budget_cash DECIMAL(14,2) DEFAULT 0,
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_flow_yv_period_org (year, version, period, org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_BUDGET_RELATION_SQL = `
CREATE TABLE IF NOT EXISTS ops_budget_relation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  parent_org_id INT NOT NULL COMMENT '上级组织(BD/领域)',
  child_org_id INT NOT NULL COMMENT '下级组织(领域/BU)',
  level VARCHAR(10) NOT NULL COMMENT 'BD/领域',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_rel_year_parent_child (year, parent_org_id, child_org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_BUDGET_ALLOCATION_SQL = `
CREATE TABLE IF NOT EXISTS ops_budget_allocation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  period VARCHAR(10),
  source_org_id INT NOT NULL COMMENT '来源组织(BD/领域)',
  target_org_id INT NOT NULL COMMENT '目标组织(领域/BU)',
  metric VARCHAR(20) NOT NULL COMMENT '预算收入/预算贡献利润/预算现金流',
  ratio DECIMAL(5,4) DEFAULT 0 COMMENT '分解比例(0~1)',
  target_value DECIMAL(14,2) DEFAULT 0 COMMENT '目标值',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_alloc_year_period_source_target_metric (year, period, source_org_id, target_org_id, metric)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* ---------- 预算管理: 版本表 ----------
 * ops_budget_version: 预算版本管理（预估版本/目标版本） */
const CREATE_BUDGET_VERSION_SQL = `
CREATE TABLE IF NOT EXISTS ops_budget_version (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  version VARCHAR(20) NOT NULL COMMENT '版本号如V1/V2/正式版',
  version_type VARCHAR(20) NOT NULL COMMENT 'estimate=预估版本/target=目标版本',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft=草稿/active=进行中/completed=已完成',
  start_date DATE,
  end_date DATE,
  remark VARCHAR(500),
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_version_year_type (year, version, version_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* ---------- 数据表管理: 元数据表 (业务分类树 + 表定义 + 字段 + 审批 + 日志) ----------
 * ops_table_meta: 树节点(type='category' 分类 | 'table' 业务表), parent_id 多层级树
 * ops_table_field: 字段定义 (主键/唯一/普通索引/外键)
 * ops_table_approval: 审批记录 (submit→pending, approve/reject 结束)
 * ops_table_log: 操作日志 */
const CREATE_TABLE_META_SQL = `
CREATE TABLE IF NOT EXISTS ops_table_meta (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '节点名称(分类名或表显示名)',
  type VARCHAR(20) NOT NULL DEFAULT 'table' COMMENT 'category=分类 | table=业务表',
  parent_id INT DEFAULT NULL COMMENT '父分类ID(null=根)',
  table_name VARCHAR(100) DEFAULT NULL COMMENT '物理表名(仅 table)',
  description VARCHAR(500) DEFAULT '' COMMENT '表注释/说明',
  status VARCHAR(20) DEFAULT 'draft' COMMENT 'draft草稿/pending审批中/approved已通过/rejected已驳回',
  created_by VARCHAR(50) DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tm_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_TABLE_FIELD_SQL = `
CREATE TABLE IF NOT EXISTS ops_table_field (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_meta_id INT NOT NULL COMMENT '所属表元数据ID',
  field_name VARCHAR(100) NOT NULL COMMENT '字段名',
  display_name VARCHAR(100) DEFAULT '' COMMENT '字段显示名',
  data_type VARCHAR(30) NOT NULL COMMENT '数据类型',
  length INT DEFAULT NULL COMMENT '长度/精度',
  nullable TINYINT(1) DEFAULT 1 COMMENT '是否允许为空',
  default_value VARCHAR(200) DEFAULT NULL COMMENT '默认值',
  comment VARCHAR(200) DEFAULT '' COMMENT '字段注释',
  is_pk TINYINT(1) DEFAULT 0 COMMENT '主键',
  is_unique TINYINT(1) DEFAULT 0 COMMENT '唯一索引',
  is_index TINYINT(1) DEFAULT 0 COMMENT '普通索引',
  fk_table VARCHAR(100) DEFAULT NULL COMMENT '外键关联表',
  fk_field VARCHAR(100) DEFAULT NULL COMMENT '外键关联字段',
  field_order INT DEFAULT 0 COMMENT '排序',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tf_meta (table_meta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_TABLE_APPROVAL_SQL = `
CREATE TABLE IF NOT EXISTS ops_table_approval (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_meta_id INT NOT NULL COMMENT '所属表元数据ID',
  action VARCHAR(20) NOT NULL DEFAULT 'create' COMMENT 'create/alter/drop',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected',
  applicant VARCHAR(50) DEFAULT 'admin' COMMENT '申请人',
  approver VARCHAR(50) DEFAULT NULL COMMENT '审批人',
  comment TEXT COMMENT '审批意见',
  snapshot TEXT COMMENT '表结构快照(JSON)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL DEFAULT NULL COMMENT '审批完成时间',
  KEY idx_ta_meta (table_meta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_TABLE_LOG_SQL = `
CREATE TABLE IF NOT EXISTS ops_table_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_meta_id INT NOT NULL COMMENT '所属表元数据ID',
  action VARCHAR(30) NOT NULL COMMENT '操作类型',
  detail TEXT COMMENT '操作详情',
  operator VARCHAR(50) DEFAULT 'admin' COMMENT '操作人',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tl_meta (table_meta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 数据表管理预置分类树: 一级分类(经营预测/运营指标/自定义) + 现有业务表注册 */
const SEED_TABLE_META = [
  { name: '经营预测', type: 'category', parent_id: null, table_name: null, description: '经营预测相关业务表' },
  { name: '运营指标', type: 'category', parent_id: null, table_name: null, description: '运营指标相关业务表' },
  { name: '自定义', type: 'category', parent_id: null, table_name: null, description: '用户自定义业务表' }
];
const SEED_TABLE_META_TABLES = [
  { name: '预算管理', type: 'table', table_name: 'ops_budget', description: '月度预算(BU×月)' },
  { name: '预测管理', type: 'table', table_name: 'ops_forecast', description: '经营预测(批次×版本×BU×月)' },
  { name: '实际回填', type: 'table', table_name: 'ops_actual', description: '月度实际(BU×月)' },
  { name: '目标拆分', type: 'table', table_name: 'ops_target_split', description: '预算目标拆分(指标×BU)' },
  { name: '项目合同', type: 'table', table_name: 'ops_records', description: '合同/项目/验收/回款主表' }
];

/* 预算目标拆分表: 指标(收入/贡献利润/现金流) × BU(软工/硬工/云/智能汽车/汇总) 唯一,
 * 存实际值(7月)与2026年目标-V1, 偏差/达成率由前端计算 */
const CREATE_TARGET_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_target_split (
  id INT AUTO_INCREMENT PRIMARY KEY,
  metric VARCHAR(20) NOT NULL,
  bu VARCHAR(20) NOT NULL,
  q1_act DECIMAL(18,6) DEFAULT 0, q2_act DECIMAL(18,6) DEFAULT 0,
  q3_act DECIMAL(18,6) DEFAULT 0, q4_act DECIMAL(18,6) DEFAULT 0,
  h1_act DECIMAL(18,6) DEFAULT 0, h2_act DECIMAL(18,6) DEFAULT 0, ytd_act DECIMAL(18,6) DEFAULT 0,
  q1_tgt DECIMAL(18,6) DEFAULT 0, q2_tgt DECIMAL(18,6) DEFAULT 0,
  q3_tgt DECIMAL(18,6) DEFAULT 0, q4_tgt DECIMAL(18,6) DEFAULT 0,
  h1_tgt DECIMAL(18,6) DEFAULT 0, h2_tgt DECIMAL(18,6) DEFAULT 0, ytd_tgt DECIMAL(18,6) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_metric_bu (metric, bu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* ---------- 预置示例数据 (表为空时自动写入) ---------- */
const SEED = [
  { 合同编号: 'HT-2025-001', 项目名称: '智慧园区管理平台', 客户名称: '深圳科创实业有限公司', 合同金额: 868000, 合同状态: '执行中', 签订日期: '2025-03-15', 项目状态: '进行中', 项目负责人: '张明', 项目开始日期: '2025-04-01', 项目截止日期: '2025-12-31', 验收状态: '待验收', 计划验收日期: '2026-01-15', 实际验收日期: '', 回款金额: 434000, 回款状态: '部分回款', 计划回款日期: '2025-09-30', 备注: '一期开发完成60%，二期需求确认中' },
  { 合同编号: 'HT-2025-002', 项目名称: '企业数据中台建设', 客户名称: '上海联拓数字科技', 合同金额: 1250000, 合同状态: '执行中', 签订日期: '2025-02-20', 项目状态: '进行中', 项目负责人: '李芳', 项目开始日期: '2025-03-01', 项目截止日期: '2025-10-31', 验收状态: '待验收', 计划验收日期: '2025-11-15', 实际验收日期: '', 回款金额: 0, 回款状态: '未回款', 计划回款日期: '2025-07-01', 备注: '回款已逾期，需催收首付款' },
  { 合同编号: 'HT-2024-088', 项目名称: '政务云迁移服务', 客户名称: '广州市政务服务中心', 合同金额: 560000, 合同状态: '已完成', 签订日期: '2024-09-10', 项目状态: '已交付', 项目负责人: '王强', 项目开始日期: '2024-10-01', 项目截止日期: '2025-03-31', 验收状态: '已验收', 计划验收日期: '2025-03-20', 实际验收日期: '2025-03-18', 回款金额: 560000, 回款状态: '已回清', 计划回款日期: '2025-04-15', 备注: '项目顺利交付，客户满意度高' },
  { 合同编号: 'HT-2025-003', 项目名称: '营销自动化系统', 客户名称: '北京云创网络科技有限公司', 合同金额: 320000, 合同状态: '已签订', 签订日期: '2025-07-01', 项目状态: '未启动', 项目负责人: '赵雪', 项目开始日期: '2025-08-15', 项目截止日期: '2026-02-28', 验收状态: '待验收', 计划验收日期: '2026-03-15', 实际验收日期: '', 回款金额: 96000, 回款状态: '部分回款', 计划回款日期: '2025-12-31', 备注: '首付款已到，等待启动会' },
  { 合同编号: 'HT-2025-004', 项目名称: '供应链优化项目', 客户名称: '浙江义乌商贸集团', 合同金额: 680000, 合同状态: '执行中', 签订日期: '2025-01-15', 项目状态: '待验收', 项目负责人: '陈伟', 项目开始日期: '2025-02-01', 项目截止日期: '2025-07-31', 验收状态: '验收中', 计划验收日期: '2025-08-01', 实际验收日期: '', 回款金额: 340000, 回款状态: '部分回款', 计划回款日期: '2025-08-10', 备注: '验收材料已提交，等待客户确认' }
];

/* ---------- 经营预测预置数据 (来自《预测结果模板.xlsx》汇总行实际值, 季度均摊到月) ---------- */
const SEED_FC = [
  { 年度: 2026, 月份: 1, 预测收入: 21312.386957, 贡献利润: 1327.451065, 现金流: -2907.370159, 费用: 0, 备注: '模板汇总行实际值·Q1（1-3月）' },
  { 年度: 2026, 月份: 2, 预测收入: 21312.386957, 贡献利润: 1327.451065, 现金流: -2907.370159, 费用: 0, 备注: '模板汇总行实际值·Q1（1-3月）' },
  { 年度: 2026, 月份: 3, 预测收入: 21312.386956, 贡献利润: 1327.451064, 现金流: -2907.37016, 费用: 0, 备注: '模板汇总行实际值·Q1（1-3月）' },
  { 年度: 2026, 月份: 4, 预测收入: 20508.778711, 贡献利润: 1923.886224, 现金流: 6361.208489, 费用: 0, 备注: '模板汇总行实际值·Q2（4-6月）' },
  { 年度: 2026, 月份: 5, 预测收入: 20508.778711, 贡献利润: 1923.886224, 现金流: 6361.208489, 费用: 0, 备注: '模板汇总行实际值·Q2（4-6月）' },
  { 年度: 2026, 月份: 6, 预测收入: 20508.778712, 贡献利润: 1923.886223, 现金流: 6361.208489, 费用: 0, 备注: '模板汇总行实际值·Q2（4-6月）' },
  { 年度: 2026, 月份: 7, 预测收入: 21511.578945, 贡献利润: 1901.713681, 现金流: -735.847697, 费用: 0, 备注: '模板汇总行实际值·Q3（7-9月）' },
  { 年度: 2026, 月份: 8, 预测收入: 21511.578945, 贡献利润: 1901.713681, 现金流: -735.847697, 费用: 0, 备注: '模板汇总行实际值·Q3（7-9月）' },
  { 年度: 2026, 月份: 9, 预测收入: 21511.578945, 贡献利润: 1901.713682, 现金流: -735.847698, 费用: 0, 备注: '模板汇总行实际值·Q3（7-9月）' },
  { 年度: 2026, 月份: 10, 预测收入: 20273.67293, 贡献利润: 1648.442544, 现金流: 5796.399392, 费用: 0, 备注: '模板汇总行实际值·Q4（10-12月）' },
  { 年度: 2026, 月份: 11, 预测收入: 20273.67293, 贡献利润: 1648.442544, 现金流: 5796.399392, 费用: 0, 备注: '模板汇总行实际值·Q4（10-12月）' },
  { 年度: 2026, 月份: 12, 预测收入: 20273.672931, 贡献利润: 1648.442545, 现金流: 5796.399393, 费用: 0, 备注: '模板汇总行实际值·Q4（10-12月）' }
];

/* ---------- 月度预算预置数据 (来自《预测结果模板.xlsx》汇总行目标值, 季度均摊到月, 季度/半年/全年自动聚合) ---------- */
const SEED_BUDGET = [
  { 年度: 2026, 月份: 1, 预算收入: 21312.386957, 预算贡献利润: 1327.451065, 预算现金流: -2907.370159, 预算费用: 0 },
  { 年度: 2026, 月份: 2, 预算收入: 21312.386957, 预算贡献利润: 1327.451065, 预算现金流: -2907.370159, 预算费用: 0 },
  { 年度: 2026, 月份: 3, 预算收入: 21312.386956, 预算贡献利润: 1327.451064, 预算现金流: -2907.37016, 预算费用: 0 },
  { 年度: 2026, 月份: 4, 预算收入: 20508.778711, 预算贡献利润: 1923.886224, 预算现金流: 6361.208489, 预算费用: 0 },
  { 年度: 2026, 月份: 5, 预算收入: 20508.778711, 预算贡献利润: 1923.886224, 预算现金流: 6361.208489, 预算费用: 0 },
  { 年度: 2026, 月份: 6, 预算收入: 20508.778712, 预算贡献利润: 1923.886223, 预算现金流: 6361.208489, 预算费用: 0 },
  { 年度: 2026, 月份: 7, 预算收入: 21553.576532, 预算贡献利润: 2224.251537, 预算现金流: -1568.395637, 预算费用: 0 },
  { 年度: 2026, 月份: 8, 预算收入: 21553.576532, 预算贡献利润: 2224.251537, 预算现金流: -1568.395637, 预算费用: 0 },
  { 年度: 2026, 月份: 9, 预算收入: 21553.576531, 预算贡献利润: 2224.251537, 预算现金流: -1568.395638, 预算费用: 0 },
  { 年度: 2026, 月份: 10, 预算收入: 20231.675344, 预算贡献利润: 1825.904702, 预算现金流: 4458.668003, 预算费用: 0 },
  { 年度: 2026, 月份: 11, 预算收入: 20231.675344, 预算贡献利润: 1825.904702, 预算现金流: 4458.668003, 预算费用: 0 },
  { 年度: 2026, 月份: 12, 预算收入: 20231.675343, 预算贡献利润: 1825.904703, 预算现金流: 4458.668004, 预算费用: 0 }
];

/* ---------- 预算目标拆分预置数据 (来自《预测结果模板.xlsx》预算目标拆分 Sheet, 2026-08 提取) ---------- */
const SEED_TARGET = [
  { 指标: '收入', BU: '软工', Q1实际: 20662.458781, Q2实际: 18896.846497, Q3实际: 19510.781376, Q4实际: 17985.907163, H1实际: 39559.305278, H2实际: 37496.688539, YTD实际: 77055.993817, Q1目标: 20662.458781, Q2目标: 18896.846497, Q3目标: 19636.774137, Q4目标: 17859.914402, H1目标: 39559.305278, H2目标: 37496.688539, YTD目标: 77055.993817 },
  { 指标: '收入', BU: '硬工', Q1实际: 18288.175768, Q2实际: 18053.412047, Q3实际: 18997.621451, Q4实际: 17698.633789, H1实际: 36341.587814, H2实际: 36696.255240, YTD实际: 73037.843054, Q1目标: 18288.175768, Q2目标: 18053.412047, Q3目标: 18997.621451, Q4目标: 17698.633790, H1目标: 36341.587814, H2目标: 36696.255240, YTD目标: 73037.843055 },
  { 指标: '收入', BU: '云', Q1实际: 11605.927452, Q2实际: 10310.641733, Q3实际: 10681.187344, Q4实际: 10904.972790, H1实际: 21916.569185, H2实际: 21586.160135, YTD实际: 43502.729320, Q1目标: 11605.927452, Q2目标: 10310.641733, Q3目标: 10681.187344, Q4目标: 10904.972790, H1目标: 21916.569185, H2目标: 21586.160135, YTD目标: 43502.729320 },
  { 指标: '收入', BU: '智能汽车', Q1实际: 13380.598869, Q2实际: 14265.435857, Q3实际: 15345.146664, Q4实际: 14231.505049, H1实际: 27646.034726, H2实际: 29576.651713, YTD实际: 57222.686439, Q1目标: 13380.598869, Q2目标: 14265.435857, Q3目标: 15345.146664, Q4目标: 14231.505049, H1目标: 27646.034726, H2目标: 29576.651713, YTD目标: 57222.686439 },
  { 指标: '收入', BU: '汇总', Q1实际: 63937.160870, Q2实际: 61526.336134, Q3实际: 64534.736835, Q4实际: 60821.018791, H1实际: 125463.497003, H2实际: 125355.755626, YTD实际: 250819.252629, Q1目标: 63937.160870, Q2目标: 61526.336134, Q3目标: 64660.729595, Q4目标: 60695.026031, H1目标: 125463.497003, H2目标: 125355.755626, YTD目标: 250819.252630 },
  { 指标: '贡献利润', BU: '软工', Q1实际: 1469.211572, Q2实际: 2117.126475, Q3实际: 1584.320261, Q4实际: 1552.868582, H1实际: 3586.338047, H2实际: 3137.188843, YTD实际: 6723.526889, Q1目标: 1469.211572, Q2目标: 2117.126475, Q3目标: 1837.868336, Q4目标: 1699.320507, H1目标: 3586.338047, H2目标: 3537.188843, YTD目标: 7123.526889 },
  { 指标: '贡献利润', BU: '硬工', Q1实际: 1612.988472, Q2实际: 1911.224145, Q3实际: 1647.346489, Q4实际: 1665.492069, H1实际: 3524.212617, H2实际: 3312.838557, YTD实际: 6837.051175, Q1目标: 1612.988472, Q2目标: 1911.224145, Q3目标: 2181.424311, Q4目标: 1531.414277, H1目标: 3524.212617, H2目标: 3712.838588, YTD目标: 7237.051206 },
  { 指标: '贡献利润', BU: '云', Q1实际: 157.692322, Q2实际: 483.485917, Q3实际: 1113.896282, Q4实际: 916.129130, H1实际: 641.178239, H2实际: 2030.025412, YTD实际: 2671.203651, Q1目标: 157.692322, Q2目标: 483.485917, Q3目标: 1113.896282, Q4目标: 1216.129140, H1目标: 641.178239, H2目标: 2330.025421, YTD目标: 2971.203660 },
  { 指标: '贡献利润', BU: '智能汽车', Q1实际: 742.460827, Q2实际: 1259.822134, Q3实际: 1359.578013, Q4实际: 810.837853, H1实际: 2002.282961, H2实际: 2170.415866, YTD实际: 4172.698827, Q1目标: 742.460827, Q2目标: 1259.822134, Q3目标: 1539.565682, Q4目标: 1030.850183, H1目标: 2002.282961, H2目标: 2570.415866, YTD目标: 4572.698827 },
  { 指标: '贡献利润', BU: '汇总', Q1实际: 3982.353194, Q2实际: 5771.658671, Q3实际: 5705.141044, Q4实际: 4945.327633, H1实际: 9754.011865, H2实际: 10650.468678, YTD实际: 20404.480542, Q1目标: 3982.353194, Q2目标: 5771.658671, Q3目标: 6672.754611, Q4目标: 5477.714107, H1目标: 9754.011865, H2目标: 12150.468718, YTD目标: 21904.480582 },
  { 指标: '现金流', BU: '软工', Q1实际: -3174.100683, Q2实际: 7942.099880, Q3实际: -2301.133041, Q4实际: 6716.454889, H1实际: 4767.999197, H2实际: 4415.321849, YTD实际: 9183.321046, Q1目标: -3174.100683, Q2目标: 7942.099880, Q3目标: -3550.334205, Q4目标: 5739.335008, H1目标: 4767.999197, H2目标: 2189.000803, YTD目标: 6957.000000 },
  { 指标: '现金流', BU: '硬工', Q1实际: -2871.758552, Q2实际: 7039.095923, Q3实际: -940.612226, Q4实际: 5419.489158, H1实际: 4167.337371, H2实际: 4478.876932, YTD实际: 8646.214303, Q1目标: -2871.758552, Q2目标: 7039.095923, Q3目标: -1834.054882, Q4目标: 4315.049240, H1目标: 4167.337371, H2目标: 2480.994358, YTD目标: 6648.331729 },
  { 指标: '现金流', BU: '云', Q1实际: -2255.747638, Q2实际: 2943.840219, Q3实际: 81.251216, Q4实际: 3867.451570, H1实际: 688.092581, H2实际: 3948.702785, YTD实际: 4636.795366, Q1目标: -2255.747638, Q2目标: 2943.840219, Q3目标: 61.251216, Q4目标: 2662.656561, H1目标: 688.092581, H2目标: 2723.907777, YTD目标: 3412.000358 },
  { 指标: '现金流', BU: '智能汽车', Q1实际: -420.503605, Q2实际: 1158.589445, Q3实际: 952.950959, Q4实际: 1385.802560, H1实际: 738.085840, H2实际: 2338.753519, YTD实际: 3076.839359, Q1目标: -420.503605, Q2目标: 1158.589445, Q3目标: 617.950959, Q4目标: 658.963201, H1目标: 738.085840, H2目标: 1276.914160, YTD目标: 2015.000000 },
  { 指标: '现金流', BU: '汇总', Q1实际: -8722.110478, Q2实际: 19083.625467, Q3实际: -2207.543092, Q4实际: 17389.198177, H1实际: 10361.514989, H2实际: 15181.655085, YTD实际: 25543.170074, Q1目标: -8722.110478, Q2目标: 19083.625467, Q3目标: -4705.186912, Q4目标: 13376.004010, H1目标: 10361.514989, H2目标: 8670.817098, YTD目标: 19032.332087 }
];

/* ---------- 转换函数 ---------- */
function rowToApi(row) {
  const api = { _id: String(row.id) };
  FIELD_PAIRS.forEach(p => {
    const cn = p[0], col = p[1], v = row[col];
    if (MONEY_COLS.has(col)) api[cn] = (v === null || v === undefined) ? 0 : Number(v);
    else if (DATE_COLS.has(col)) api[cn] = v ? String(v).split(' ')[0] : '';
    else api[cn] = (v === null || v === undefined) ? '' : String(v);
  });
  return api;
}
function apiToDb(record) {
  const db = {};
  Object.keys(CN2COL).forEach(cn => {
    if (!(cn in record)) return;
    const col = CN2COL[cn], v = record[cn];
    if (MONEY_COLS.has(col)) db[col] = parseFloat(v) || 0;
    else if (DATE_COLS.has(col)) db[col] = (v === '' || v === null || v === undefined) ? null : String(v);
    else db[col] = (v === '' || v === null || v === undefined) ? null : String(v);
  });
  return db;
}
function fcRowToApi(row) {
  const api = { _id: String(row.id) };
  FC_FIELD_PAIRS.forEach(p => {
    const cn = p[0], col = p[1], v = row[col];
    if (FC_MONEY_COLS.has(col)) api[cn] = (v === null || v === undefined) ? 0 : Number(v);
    else api[cn] = (v === null || v === undefined) ? '' : String(v);
  });
  api['预测批次'] = row.fc_month ? Number(row.fc_month) : 0;
  api['版本'] = row.version || '';
  if (!api['BU']) api['BU'] = '汇总';
  return api;
}
function fcApiToDb(record) {
  const db = {};
  Object.keys(FC_CN2COL).forEach(cn => {
    if (!(cn in record)) return;
    const col = FC_CN2COL[cn], v = record[cn];
    if (FC_MONEY_COLS.has(col)) db[col] = parseFloat(v) || 0;
    else if (col === 'year' || col === 'month') db[col] = parseInt(v, 10) || 0;
    else if (col === 'bu') db[col] = (v === '' || v === null || v === undefined) ? '汇总' : String(v);
    else db[col] = (v === '' || v === null || v === undefined) ? null : String(v);
  });
  if ('预测批次' in record) db.fc_month = parseInt(record['预测批次'], 10) || 0;
  if ('版本' in record) db.version = String(record['版本'] || 'V1');
  return db;
}
function budgetRowToApi(row) {
  const api = { _id: String(row.id), 年度: row.year, 月份: row.month, BU: row.bu || '汇总' };
  BUDGET_FIELD_PAIRS.forEach(p => {
    const cn = p[0], col = p[1];
    if (cn === '年度' || cn === '月份' || cn === 'BU') return;
    const v = row[col];
    if (BUDGET_MONEY_COLS.has(col)) api[cn] = (v === null || v === undefined) ? 0 : Number(v);
    else api[cn] = (v === null || v === undefined) ? '' : String(v);
  });
  return api;
}
function budgetApiToDb(record) {
  const db = {};
  Object.keys(BUDGET_CN2COL).forEach(cn => {
    if (!(cn in record)) return;
    const col = BUDGET_CN2COL[cn], v = record[cn];
    if (BUDGET_MONEY_COLS.has(col)) db[col] = parseFloat(v) || 0;
    else if (col === 'year' || col === 'month') db[col] = parseInt(v, 10) || 0;
    else if (col === 'bu') db[col] = (v === '' || v === null || v === undefined) ? '汇总' : String(v);
    else db[col] = (v === '' || v === null || v === undefined) ? null : String(v);
  });
  return db;
}
function actualRowToApi(row) {
  const api = { _id: String(row.id), 年度: row.year, 月份: row.month, BU: row.bu || '软工' };
  ACTUAL_FIELD_PAIRS.forEach(p => {
    const cn = p[0], col = p[1], v = row[col];
    if (cn === '年度' || cn === '月份' || cn === 'BU') return;
    if (ACTUAL_MONEY_COLS.has(col)) api[cn] = (v === null || v === undefined) ? 0 : Number(v);
    else api[cn] = (v === null || v === undefined) ? '' : String(v);
  });
  return api;
}
function actualApiToDb(record) {
  const db = {};
  Object.keys(ACTUAL_CN2COL).forEach(cn => {
    if (!(cn in record)) return;
    const col = ACTUAL_CN2COL[cn], v = record[cn];
    if (ACTUAL_MONEY_COLS.has(col)) db[col] = parseFloat(v) || 0;
    else if (col === 'year' || col === 'month') db[col] = parseInt(v, 10) || 0;
    else if (col === 'bu') db[col] = (v === '' || v === null || v === undefined) ? '软工' : String(v);
    else db[col] = (v === '' || v === null || v === undefined) ? null : String(v);
  });
  return db;
}
function targetRowToApi(row) {
  const api = { _id: String(row.id) };
  TARGET_FIELD_PAIRS.forEach(p => {
    const cn = p[0], col = p[1], v = row[col];
    if (TARGET_MONEY_COLS.has(col)) api[cn] = (v === null || v === undefined) ? 0 : Number(v);
    else api[cn] = (v === null || v === undefined) ? '' : String(v);
  });
  return api;
}
function targetApiToDb(record) {
  const db = {};
  Object.keys(TARGET_CN2COL).forEach(cn => {
    if (!(cn in record)) return;
    const col = TARGET_CN2COL[cn], v = record[cn];
    if (TARGET_MONEY_COLS.has(col)) db[col] = parseFloat(v) || 0;
    else db[col] = (v === '' || v === null || v === undefined) ? null : String(v);
  });
  return db;
}

/* ---------- HTTP 工具 ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(body);
}
// MySQL JSON 列: mysql2 默认已解析为 JS 对象, 此处兼容「字符串 / 已解析对象」两种形态
function parseJsonArr(v) {
  if (v == null) return [];
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return []; } }
  return Array.isArray(v) ? v : [];
}
function jsonStr(v) {
  if (v == null) return '[]';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/* ---------- 系统管理辅助: 密码哈希 / 会话 / 鉴权 (RBAC) ---------- */
const crypto = require('crypto');
const SESSION_DAYS = 7;   // 登录会话有效期(天)
function hashPassword(pwd, salt) { return crypto.createHash('sha256').update(salt + ':' + pwd).digest('hex'); }
function genSalt() { return crypto.randomBytes(8).toString('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }
// 从请求提取登录用户: 校验 Authorization: Bearer <token> -> sys_session -> sys_user
async function requireAuth(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+([0-9a-f]{64})$/i);
  if (!m) return null;
  const [[row]] = await pool.query(
    `SELECT u.id, u.username, u.real_name, u.email, u.phone, u.org_id, u.status
     FROM sys_session s JOIN sys_user u ON u.id = s.user_id
     WHERE s.token=? AND s.expires_at > NOW()`, [m[1]]);
  if (!row || row.status !== 1) return null;
  return row;
}
// 查询用户权限码集合 (通过 用户->角色->权限)
async function getUserPermCodes(userId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.code FROM sys_permission p
     JOIN sys_role_permission rp ON rp.permission_id = p.id
     JOIN sys_user_role ur ON ur.role_id = rp.role_id
     WHERE ur.user_id=? AND p.code<>''`, [userId]);
  return rows.map(r => r.code);
}
// 查询用户角色列表
async function getUserRoles(userId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.name, r.code FROM sys_role r
     JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id=? ORDER BY r.id`, [userId]);
  return rows;
}
// admin 校验: 拥有 system:admin 权限视为管理员
async function isAdminUser(userId) {
  const codes = await getUserPermCodes(userId);
  return codes.indexOf('system:admin') >= 0;
}
async function requireAdmin(req, res) {
  const auth = await requireAuth(req);
  if (!auth) return send(res, 401, { error: '未登录或会话已过期' });
  if (!(await isAdminUser(auth.id))) return send(res, 403, { error: '无权限：仅管理员可访问后台管理' });
  return auth;
}

/* ---------- API 路由 ---------- */
async function handleApi(req, res, pathname, method) {
  // ---- 认证: 登录放行, 其余 API 全部要求登录 ----
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return send(res, 400, { error: '请输入用户名和密码' });
    const [[user]] = await pool.query('SELECT * FROM sys_user WHERE username=?', [username]);
    if (!user || user.status !== 1) return send(res, 401, { error: '用户名或密码错误' });
    if (hashPassword(password, user.salt) !== user.password) return send(res, 401, { error: '用户名或密码错误' });
    const token = genToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
    await pool.query('INSERT INTO sys_session (token, user_id, expires_at) VALUES (?,?,?)', [token, user.id, expiresAt]);
    // 清理过期会话
    await pool.query('DELETE FROM sys_session WHERE expires_at <= NOW()').catch(() => {});
    const roles = await getUserRoles(user.id);
    const perms = await getUserPermCodes(user.id);
    return send(res, 200, {
      token,
      user: { id: user.id, username: user.username, realName: user.real_name, email: user.email, phone: user.phone, orgId: user.org_id },
      roles: roles.map(r => r.code),
      perms
    });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+([0-9a-f]{64})$/i);
    if (m) await pool.query('DELETE FROM sys_session WHERE token=?', [m[1]]).catch(() => {});
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/auth/me' && method === 'GET') {
    const auth = await requireAuth(req);
    if (!auth) return send(res, 401, { error: '未登录或会话已过期' });
    const roles = await getUserRoles(auth.id);
    const perms = await getUserPermCodes(auth.id);
    return send(res, 200, { user: auth, roles: roles.map(r => r.code), perms });
  }
  // 其余所有 /api/* 均需登录
  const auth = await requireAuth(req);
  if (!auth) return send(res, 401, { error: '未登录或会话已过期' });
  req.auth = auth;

  if (pathname === '/api/records') {
    if (method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM ops_records ORDER BY sign_date DESC, id DESC');
      return send(res, 200, rows.map(rowToApi));
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const db = apiToDb(body);
      const cols = Object.keys(db);
      if (cols.length === 0) return send(res, 400, { error: 'no valid fields' });
      const [r] = await pool.query(
        `INSERT INTO ops_records (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map(c => db[c])
      );
      return send(res, 201, { _id: String(r.insertId) });
    }
  }
  if (pathname === '/api/forecast/versions' && method === 'GET') {
    // 版本索引: 批次(fc_month) × 版本 × 年份
    const [rows] = await pool.query(
      'SELECT fc_month, version, year, COUNT(*) AS cnt, MAX(updated_at) AS updated_at FROM ops_forecast WHERE fc_month IS NOT NULL GROUP BY fc_month, version, year ORDER BY fc_month DESC, version ASC, year ASC'
    );
    return send(res, 200, rows.map(r => ({ fcMonth: r.fc_month, version: r.version, year: r.year, count: r.cnt, updatedAt: r.updated_at })));
  }
  if (pathname === '/api/forecast/batch' && method === 'POST') {
    // 整批导入/覆盖: {fcMonth, version, year, bu?, records:[{年度,月份,BU?,预测收入,...}...]}
    // bu 为文件级 BU: 传入则只覆盖该 BU; 不传则整批覆盖(含所有 BU)
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    const fcMonth = parseInt((body && body.fcMonth) || (list[0] && list[0]['预测批次']) || 0, 10) || await defaultFcBatch();
    const version = String((body && body.version) || (list[0] && list[0]['版本']) || 'V1');
    const year = parseInt((body && body.year) || (list[0] && list[0]['年度']) || 0, 10);
    const bu = String((body && body.bu) || (list[0] && list[0]['BU']) || '');
    if (!year) return send(res, 400, { error: 'year required' });
    if (list.length === 0) return send(res, 400, { error: 'expected non-empty records' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let delSql = 'DELETE FROM ops_forecast WHERE fc_month=? AND version=? AND year=?';
      const delParams = [fcMonth, version, year];
      if (bu) { delSql += ' AND bu=?'; delParams.push(bu); }
      await conn.query(delSql, delParams);
      let count = 0;
      for (const rec of list) {
        const recBu = bu || (rec && rec['BU']) || '汇总';
        const db = fcApiToDb(Object.assign({}, rec, { '预测批次': fcMonth, '版本': version, '年度': year, 'BU': recBu }));
        const cols = Object.keys(db);
        if (cols.length === 0 || !db.year || !db.month) continue;
        await conn.query(
          `INSERT INTO ops_forecast (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map(c => db[c])
        );
        count++;
      }
      await conn.commit();
      return send(res, 200, { count, fcMonth, version, year, bu: bu || null });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  if (pathname === '/api/forecast/clone' && method === 'POST') {
    // 复制版本: {fromFcMonth, fromVersion, toFcMonth, toVersion} (同批次新版本 / 滚动到下月新批次)
    // 复制全部 BU 行
    const body = await readBody(req);
    const fromFcMonth = parseInt(body.fromFcMonth, 10) || 0;
    const fromVersion = String(body.fromVersion || 'V1');
    const toFcMonth = parseInt(body.toFcMonth, 10) || 0;
    const toVersion = String(body.toVersion || 'V1');
    if (!fromFcMonth || !toFcMonth) return send(res, 400, { error: 'fromFcMonth and toFcMonth required' });
    const [src] = await pool.query('SELECT * FROM ops_forecast WHERE fc_month=? AND version=?', [fromFcMonth, fromVersion]);
    if (src.length === 0) return send(res, 404, { error: 'source version empty' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM ops_forecast WHERE fc_month=? AND version=?', [toFcMonth, toVersion]);
      for (const r of src) {
        await conn.query(
          'INSERT INTO ops_forecast (fc_month, version, bu, year, month, forecast_revenue, contribution_profit, cash_flow, expense, remark) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [toFcMonth, toVersion, r.bu || '汇总', r.year, r.month, r.forecast_revenue, r.contribution_profit, r.cash_flow, r.expense, r.remark]
        );
      }
      await conn.commit();
      return send(res, 200, { count: src.length, fcMonth: toFcMonth, version: toVersion });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  if (pathname === '/api/forecast/version' && method === 'DELETE') {
    // 删除整个版本: ?fcMonth=202608&version=V1
    const q = new URL(req.url, 'http://x');
    const fcMonth = parseInt(q.searchParams.get('fcMonth'), 10);
    const version = q.searchParams.get('version');
    if (!fcMonth || !version) return send(res, 400, { error: 'fcMonth and version required' });
    const [r] = await pool.query('DELETE FROM ops_forecast WHERE fc_month=? AND version=?', [fcMonth, version]);
    return send(res, 200, { ok: true, deleted: r.affectedRows });
  }
  if (pathname === '/api/forecast') {
    if (method === 'GET') {
      const q = new URL(req.url, 'http://x');
      const fcMonth = parseInt(q.searchParams.get('fcMonth') || q.searchParams.get('fc_month') || '', 10) || 0;
      const version = q.searchParams.get('version');
      const year = q.searchParams.get('year');
      const bu = q.searchParams.get('bu');
      let sql = 'SELECT * FROM ops_forecast WHERE 1=1';
      const params = [];
      if (fcMonth) { sql += ' AND fc_month=?'; params.push(fcMonth); }
      if (version) { sql += ' AND version=?'; params.push(String(version)); }
      if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
      if (bu) { sql += ' AND bu=?'; params.push(String(bu)); }
      if (!fcMonth) {
        // 兼容旧调用(仅按年): 自动取最新批次
        sql += ' AND fc_month=?'; params.push(await defaultFcBatch());
      }
      sql += ' ORDER BY year ASC, month ASC';
      const [rows] = await pool.query(sql, params);
      return send(res, 200, rows.map(fcRowToApi));
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const db = fcApiToDb(body);
      const cols = Object.keys(db);
      if (cols.length === 0) return send(res, 400, { error: 'no valid fields' });
      if (!db.fc_month) db.fc_month = await defaultFcBatch();
      if (!db.version) db.version = 'V1';
      if (!db.bu) db.bu = '汇总';
      // 唯一键 (fc_month, version, bu, year, month): 已存在则按同一键更新
      const updCols = cols.filter(c => c !== 'year' && c !== 'month' && c !== 'fc_month' && c !== 'version' && c !== 'bu');
      let sql;
      if (updCols.length > 0) {
        sql = `INSERT INTO ops_forecast (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
               ON DUPLICATE KEY UPDATE ${updCols.map(c => c + '=VALUES(' + c + ')').join(',')}`;
      } else {
        sql = `INSERT IGNORE INTO ops_forecast (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      }
      const [r] = await pool.query(sql, cols.map(c => db[c]));
      const id = r.insertId || (await pool.query('SELECT id FROM ops_forecast WHERE fc_month=? AND version=? AND bu=? AND year=? AND month=?', [db.fc_month, db.version, db.bu, db.year, db.month]))[0][0].id;
      return send(res, 201, { _id: String(id) });
    }
  }
  if (pathname === '/api/budget/batch' && method === 'POST') {
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    if (list.length === 0) return send(res, 400, { error: 'expected non-empty array' });
    const year = parseInt(list[0]['年度'], 10) || 0;
    if (!year) return send(res, 400, { error: 'year required' });
    // 文件级 BU: 传入则只覆盖该 BU; 不传则整批覆盖(含所有 BU)
    const bu = String((body && body.bu) || (list[0] && list[0]['BU']) || '');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let delSql = 'DELETE FROM ops_budget WHERE year=?';
      const delParams = [year];
      if (bu) { delSql += ' AND bu=?'; delParams.push(bu); }
      await conn.query(delSql, delParams);
      let count = 0;
      for (const rec of list) {
        const recBu = bu || (rec && rec['BU']) || '汇总';
        const db = budgetApiToDb(Object.assign({}, rec, { 'BU': recBu }));
        const cols = Object.keys(db);
        if (cols.length === 0 || !db.year || !db.month) continue;
        await conn.query(
          `INSERT INTO ops_budget (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map(c => db[c])
        );
        count++;
      }
      await conn.commit();
      return send(res, 200, { count, year, bu: bu || null });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  if (pathname === '/api/budget') {
    if (method === 'GET') {
      const q = new URL(req.url, 'http://x');
      const year = q.searchParams.get('year');
      const bu = q.searchParams.get('bu');
      let sql = 'SELECT * FROM ops_budget WHERE 1=1';
      const params = [];
      if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
      if (bu) { sql += ' AND bu=?'; params.push(String(bu)); }
      sql += ' ORDER BY year ASC, month ASC';
      const [rows] = await pool.query(sql, params);
      return send(res, 200, rows.map(budgetRowToApi));
    }
    if (method === 'POST' || method === 'PUT') {
      const body = await readBody(req);
      const db = budgetApiToDb(body);
      if (!db.year || !db.month) return send(res, 400, { error: 'year and month required' });
      if (!db.bu) db.bu = '汇总';
      const cols = Object.keys(db);
      const updCols = cols.filter(c => c !== 'year' && c !== 'month' && c !== 'bu');
      let sql;
      if (updCols.length > 0) {
        sql = `INSERT INTO ops_budget (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
               ON DUPLICATE KEY UPDATE ${updCols.map(c => c + '=VALUES(' + c + ')').join(',')}`;
      } else {
        sql = `INSERT IGNORE INTO ops_budget (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      }
      const [r] = await pool.query(sql, cols.map(c => db[c]));
      const id = r.insertId || (await pool.query('SELECT id FROM ops_budget WHERE year=? AND month=? AND bu=?', [db.year, db.month, db.bu]))[0][0].id;
      return send(res, 200, { _id: String(id) });
    }
  }
  if (pathname === '/api/actual/batch' && method === 'POST') {
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    if (list.length === 0) return send(res, 400, { error: 'expected non-empty array' });
    const year = parseInt(list[0]['年度'], 10) || 0;
    if (!year) return send(res, 400, { error: 'year required' });
    const bu = String((body && body.bu) || (list[0] && list[0]['BU']) || '');
    if (!bu || bu === '汇总') return send(res, 400, { error: 'actual requires specific bu (汇总 = 各BU之和, 自动计算, 不可录入)' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM ops_actual WHERE year=? AND bu=?', [year, bu]);
      let count = 0;
      for (const rec of list) {
        const db = actualApiToDb(Object.assign({}, rec, { 'BU': bu }));
        const cols = Object.keys(db);
        if (cols.length === 0 || !db.year || !db.month) continue;
        await conn.query(
          `INSERT INTO ops_actual (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map(c => db[c])
        );
        count++;
      }
      await conn.commit();
      return send(res, 200, { count, year, bu });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  if (pathname === '/api/actual') {
    if (method === 'GET') {
      const q = new URL(req.url, 'http://x');
      const year = q.searchParams.get('year');
      const bu = q.searchParams.get('bu');
      if (bu === '汇总' || !bu) {
        // 汇总口径 = 各 BU 之和, 按月聚合
        let sql = 'SELECT year, month, SUM(actual_revenue) AS actual_revenue, SUM(actual_profit) AS actual_profit, SUM(actual_cash) AS actual_cash, SUM(actual_expense) AS actual_expense FROM ops_actual WHERE bu IS NOT NULL AND bu <> \'汇总\'';
        const params = [];
        if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
        sql += ' GROUP BY year, month ORDER BY year ASC, month ASC';
        const [rows] = await pool.query(sql, params);
        return send(res, 200, rows.map(r => ({
          _id: 'agg_' + r.year + '_' + r.month,
          年度: r.year, 月份: r.month, BU: '汇总',
          实际收入: Number(r.actual_revenue) || 0, 实际贡献利润: Number(r.actual_profit) || 0,
          实际现金流: Number(r.actual_cash) || 0, 实际费用: Number(r.actual_expense) || 0, 备注: ''
        })));
      }
      let sql = 'SELECT * FROM ops_actual WHERE bu=?';
      const params = [String(bu)];
      if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
      sql += ' ORDER BY year ASC, month ASC';
      const [rows] = await pool.query(sql, params);
      return send(res, 200, rows.map(actualRowToApi));
    }
    if (method === 'POST' || method === 'PUT') {
      const body = await readBody(req);
      const db = actualApiToDb(body);
      if (!db.year || !db.month) return send(res, 400, { error: 'year and month required' });
      if (!db.bu) db.bu = '软工';
      if (db.bu === '汇总') return send(res, 400, { error: '汇总 = 各BU之和, 不可单独录入' });
      const cols = Object.keys(db);
      const updCols = cols.filter(c => c !== 'year' && c !== 'month' && c !== 'bu');
      let sql;
      if (updCols.length > 0) {
        sql = `INSERT INTO ops_actual (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
               ON DUPLICATE KEY UPDATE ${updCols.map(c => c + '=VALUES(' + c + ')').join(',')}`;
      } else {
        sql = `INSERT IGNORE INTO ops_actual (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      }
      const [r] = await pool.query(sql, cols.map(c => db[c]));
      const id = r.insertId || (await pool.query('SELECT id FROM ops_actual WHERE bu=? AND year=? AND month=?', [db.bu, db.year, db.month]))[0][0].id;
      return send(res, 200, { _id: String(id) });
    }
  }
  const am = pathname.match(/^\/api\/actual\/(\d+)$/);
  if (am) {
    const id = parseInt(am[1], 10);
    if (method === 'PUT') {
      const body = await readBody(req);
      const db = actualApiToDb(body);
      const cols = Object.keys(db).filter(c => c !== 'bu');
      if (cols.length === 0) return send(res, 400, { error: 'no valid fields' });
      const [r] = await pool.query(
        `UPDATE ops_actual SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`,
        [...cols.map(c => db[c]), id]
      );
      if (r.affectedRows === 0) return send(res, 404, { error: 'not found' });
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      const [r] = await pool.query('DELETE FROM ops_actual WHERE id=?', [id]);
      if (r.affectedRows === 0) return send(res, 404, { error: 'not found' });
      return send(res, 200, { ok: true });
    }
  }

  /* ---------- 预算流程 API: BD→领域→BU 三级预算编制 ---------- */
  // 获取预算编制状态树
  if (pathname === '/api/budget-flow/tree' && method === 'GET') {
    const q = new URL(req.url, 'http://x');
    const year = parseInt(q.searchParams.get('year') || new Date().getFullYear(), 10);
    const version = q.searchParams.get('version') || 'V1';
    const versionType = q.searchParams.get('version_type') || 'estimate';
    const period = q.searchParams.get('period') || 'Q1';
    // 获取可用版本列表（优先从版本表查，否则回退到流表）
    let versionList = [version];
    try {
      const [vers] = await pool.query('SELECT version FROM ops_budget_version WHERE year=? AND version_type=? ORDER BY version DESC', [year, versionType]);
      if (vers.length) versionList = vers.map(v => v.version);
    } catch (e) { /* 版本表不存在时回退 */ }
    if (versionList.length === 0) versionList = [version];
    // 读取所有组织的预算编制状态
    const [flows] = await pool.query('SELECT * FROM ops_budget_flow WHERE year=? AND version=? AND period=?', [year, version, period]);
    const flowMap = {};
    flows.forEach(f => { flowMap[f.org_id] = f; });
    // 从 sys_org 获取组织树（含 depth）
    const [orgRows] = await pool.query('SELECT * FROM sys_org WHERE status=1 ORDER BY sort ASC, id ASC');
    // 构建节点映射
    const nodes = {};
    orgRows.forEach(r => {
      nodes[r.id] = { id: r.id, name: r.name, parentId: r.parent_id, depth: 0, children: [] };
    });
    // 父子关系
    const roots = [];
    orgRows.forEach(r => {
      if (r.parent_id && nodes[r.parent_id]) nodes[r.parent_id].children.push(nodes[r.id]);
      else roots.push(nodes[r.id]);
    });
    // 计算深度
    const calcDepth = (list, d) => {
      list.forEach(n => { n.depth = d; calcDepth(n.children, d + 1); });
    };
    calcDepth(roots, 1);
    // 映射到扁平列表
    const flatOrgs = [];
    const flatMap = {};
    const flatWalk = (list) => {
      list.forEach(n => { flatOrgs.push(n); flatMap[n.id] = n; flatWalk(n.children); });
    };
    flatWalk(roots);
    // 构建预算树
    const buildBudgetTree = (list) => {
      return list.map(o => {
        const flow = flowMap[o.id] || { status: 'draft', source: 'manual', budget_revenue: 0, budget_profit: 0, budget_cash: 0 };
        const children = buildBudgetTree(o.children);
        return {
          id: o.id, name: o.name, depth: o.depth,
          level: o.depth === 1 ? '集团' : (o.depth === 2 ? 'BG' : (o.depth === 3 ? 'BD' : (o.depth === 4 ? '领域' : 'BU'))),
          status: flow.status || 'draft', source: flow.source || 'manual',
          budget_revenue: Number(flow.budget_revenue) || 0,
          budget_profit: Number(flow.budget_profit) || 0,
          budget_cash: Number(flow.budget_cash) || 0,
          children
        };
      });
    };
    const budgetTree = buildBudgetTree(roots);
    // 计算顶级汇总
    let totalRevenue = 0, totalProfit = 0, totalCash = 0;
    const calcTotal = (list) => {
      list.forEach(n => {
        totalRevenue += n.budget_revenue || 0;
        totalProfit += n.budget_profit || 0;
        totalCash += n.budget_cash || 0;
        if (n.children && n.children.length) calcTotal(n.children);
      });
    };
    calcTotal(budgetTree);
    return send(res, 200, { year, version, versionList, period, totalRevenue, totalProfit, totalCash, tree: budgetTree });
  }

  // 获取版本列表
  if (pathname === '/api/budget-flow/versions' && method === 'GET') {
    const q = new URL(req.url, 'http://x');
    const year = parseInt(q.searchParams.get('year') || new Date().getFullYear(), 10);
    const [versions] = await pool.query('SELECT DISTINCT version FROM ops_budget_flow WHERE year=? ORDER BY version', [year]);
    return send(res, 200, { year, versions: versions.length ? versions.map(v => v.version) : ['V1'] });
  }

  // 汇总下级预算
  if (pathname === '/api/budget-flow/collect' && method === 'POST') {
    const body = await readBody(req);
    const year = parseInt(body.year, 10);
    const version = body.version || 'V1';
    const period = body.period || 'Q1';
    const targetOrgId = parseInt(body.targetOrgId, 10);
    if (!year || !targetOrgId) return send(res, 400, { error: 'year and targetOrgId required' });
    // 获取所有下级组织（递归）
    const getAllChildren = (parentId) => {
      const children = orgs.filter(o => o.parent_id === parentId);
      let result = [...children];
      children.forEach(c => { result = result.concat(getAllChildren(c.id)); });
      return result;
    };
    const [orgs] = await pool.query('SELECT id, name, parent_id FROM sys_org WHERE status=1');
    const allChildren = getAllChildren(targetOrgId);
    if (allChildren.length === 0) return send(res, 400, { error: 'no child orgs to collect' });
    // 汇总下级预算
    let totalRevenue = 0, totalProfit = 0, totalCash = 0;
    for (const c of allChildren) {
      const [[f]] = await pool.query('SELECT budget_revenue, budget_profit, budget_cash FROM ops_budget_flow WHERE year=? AND version=? AND period=? AND org_id=?', [year, version, period, c.id]);
      if (f) {
        totalRevenue += Number(f.budget_revenue) || 0;
        totalProfit += Number(f.budget_profit) || 0;
        totalCash += Number(f.budget_cash) || 0;
      }
    }
    // 写入汇总记录
    const [[org]] = await pool.query('SELECT depth FROM sys_org WHERE id=?', [targetOrgId]);
    const level = org && org.depth === 3 ? 'BD' : '领域';
    await pool.query(
      `INSERT INTO ops_budget_flow (year, version, period, org_id, level, status, source, budget_revenue, budget_profit, budget_cash)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE budget_revenue=VALUES(budget_revenue), budget_profit=VALUES(budget_profit), budget_cash=VALUES(budget_cash), status=VALUES(status), source=VALUES(source)`,
      [year, version, period, targetOrgId, level, 'draft', 'collected', totalRevenue, totalProfit, totalCash]
    );
    return send(res, 200, { ok: true, collected: allChildren.length, totalRevenue, totalProfit, totalCash });
  }

  // 分解预算到下级
  if (pathname === '/api/budget-flow/allocate' && method === 'POST') {
    const body = await readBody(req);
    const year = parseInt(body.year, 10);
    const version = body.version || 'V1';
    const period = body.period || 'Q1';
    const sourceOrgId = parseInt(body.sourceOrgId, 10);
    const allocations = body.allocations || [];
    if (!year || !sourceOrgId || allocations.length === 0) return send(res, 400, { error: 'year, sourceOrgId and allocations required' });
    // 获取上级预算
    const [[sourceFlow]] = await pool.query('SELECT * FROM ops_budget_flow WHERE year=? AND version=? AND period=? AND org_id=?', [year, version, period, sourceOrgId]);
    if (!sourceFlow) return send(res, 400, { error: 'source org has no budget to allocate' });
    let count = 0;
    for (const alloc of allocations) {
      const targetOrgId = parseInt(alloc.orgId, 10);
      const ratio = parseFloat(alloc.ratio) || 0;
      const revenue = Math.round(sourceFlow.budget_revenue * ratio * 100) / 100;
      const profit = Math.round(sourceFlow.budget_profit * ratio * 100) / 100;
      const cash = Math.round(sourceFlow.budget_cash * ratio * 100) / 100;
      const [[targetOrg]] = await pool.query('SELECT depth FROM sys_org WHERE id=?', [targetOrgId]);
      const level = targetOrg && targetOrg.depth === 4 ? 'BU' : '领域';
      // 写入分解记录
      await pool.query(
        `INSERT INTO ops_budget_flow (year, version, period, org_id, level, status, source, budget_revenue, budget_profit, budget_cash)
         VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE budget_revenue=VALUES(budget_revenue), budget_profit=VALUES(budget_profit), budget_cash=VALUES(budget_cash), status=VALUES(status), source=VALUES(source)`,
        [year, version, period, targetOrgId, level, 'draft', 'allocated', revenue, profit, cash]
      );
      // 写入分解比例
      await pool.query(
        `INSERT INTO ops_budget_allocation (year, period, source_org_id, target_org_id, metric, ratio, target_value) VALUES (?,?,?,?,?,?,?)`,
        [year, period, sourceOrgId, targetOrgId, '预算收入', ratio, revenue]
      );
      count++;
    }
    // 更新源组织状态为已分解
    await pool.query('UPDATE ops_budget_flow SET status=? WHERE year=? AND version=? AND period=? AND org_id=?', ['allocated', year, version, period, sourceOrgId]);
    return send(res, 200, { ok: true, allocated: count });
  }

  // 提交/审批
  if (pathname === '/api/budget-flow/submit' && method === 'POST') {
    const body = await readBody(req);
    const year = parseInt(body.year, 10);
    const version = body.version || 'V1';
    const period = body.period || 'Q1';
    const orgId = parseInt(body.orgId, 10);
    const action = body.action;  // submit / approve / reject
    if (!year || !orgId || !action) return send(res, 400, { error: 'year, orgId and action required' });
    const [[flow]] = await pool.query('SELECT * FROM ops_budget_flow WHERE year=? AND version=? AND period=? AND org_id=?', [year, version, period, orgId]);
    if (!flow) return send(res, 404, { error: 'budget flow not found' });
    let newStatus = flow.status;
    if (action === 'submit') newStatus = 'submitted';
    else if (action === 'approve') newStatus = 'approved';
    else if (action === 'reject') newStatus = 'rejected';
    else return send(res, 400, { error: 'invalid action' });
    await pool.query('UPDATE ops_budget_flow SET status=? WHERE year=? AND version=? AND period=? AND org_id=?', [newStatus, year, version, period, orgId]);
    return send(res, 200, { ok: true, status: newStatus });
  }

  // 预算填报（单个组织）
  if (pathname === '/api/budget-flow' && method === 'POST') {
    const body = await readBody(req);
    const year = parseInt(body.year, 10);
    const version = body.version || 'V1';
    const period = body.period || 'Q1';
    const orgId = parseInt(body.orgId, 10);
    if (!year || !orgId) return send(res, 400, { error: 'year and orgId required' });
    const [[org]] = await pool.query('SELECT depth FROM sys_org WHERE id=?', [orgId]);
    const level = org && org.depth === 3 ? 'BD' : (org && org.depth === 4 ? '领域' : 'BU');
    await pool.query(
      `INSERT INTO ops_budget_flow (year, version, period, org_id, level, status, source, budget_revenue, budget_profit, budget_cash, remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE budget_revenue=VALUES(budget_revenue), budget_profit=VALUES(budget_profit), budget_cash=VALUES(budget_cash), remark=VALUES(remark), status=VALUES(status)`,
      [year, version, period, orgId, level, body.status || 'draft', body.source || 'manual',
       parseFloat(body.budget_revenue) || 0, parseFloat(body.budget_profit) || 0, parseFloat(body.budget_cash) || 0, body.remark || '']
    );
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/budget-flow' && method === 'GET') {
    const q = new URL(req.url, 'http://x');
    const year = parseInt(q.searchParams.get('year') || new Date().getFullYear(), 10);
    const version = q.searchParams.get('version') || 'V1';
    const period = q.searchParams.get('period') || 'Q1';
    const orgId = q.searchParams.get('orgId');
    let sql = 'SELECT * FROM ops_budget_flow WHERE year=? AND version=? AND period=?';
    const params = [year, version, period];
    if (orgId) { sql += ' AND org_id=?'; params.push(parseInt(orgId, 10)); }
    const [rows] = await pool.query(sql, params);
    // 补充组织名称
    const orgIds = [...new Set(rows.map(r => r.org_id))];
    const orgMap = {};
    if (orgIds.length > 0) {
      const [orgs] = await pool.query('SELECT id, name, depth FROM sys_org WHERE id IN (' + orgIds.join(',') + ')');
      orgs.forEach(o => { orgMap[o.id] = o; });
    }
    return send(res, 200, rows.map(r => ({
      orgId: r.org_id, orgName: orgMap[r.org_id]?.name || '未知',
      level: r.level, status: r.status, source: r.source,
      budget_revenue: Number(r.budget_revenue), budget_profit: Number(r.budget_profit), budget_cash: Number(r.budget_cash), remark: r.remark
    })));
  }

  if (pathname === '/api/budget-flow' && method === 'DELETE') {
    const q = new URL(req.url, 'http://x');
    const id = q.searchParams.get('id');
    if (!id) return send(res, 400, { error: 'id required' });
    await pool.query('DELETE FROM ops_budget_flow WHERE id=?', [parseInt(id, 10)]);
    return send(res, 200, { ok: true });
  }

  /* ---------- 预算版本管理 API ----------
   * 预估版本: 从下到上汇集 -> 完成预估
   * 目标版本: 从上到下分解 -> 确认目标 -> 生成正式版 */
  if (pathname === '/api/budget-version' && method === 'GET') {
    const q = new URL(req.url, 'http://x');
    const year = q.searchParams.get('year');
    const type = q.searchParams.get('type'); // estimate/target
    let sql = 'SELECT * FROM ops_budget_version';
    const params = [];
    const cond = [];
    if (year) { cond.push('year=?'); params.push(parseInt(year)); }
    if (type) { cond.push('version_type=?'); params.push(type); }
    if (cond.length > 0) sql += ' WHERE ' + cond.join(' AND ');
    sql += ' ORDER BY year DESC, version DESC';
    const [versions] = await pool.query(sql, params);
    return send(res, 200, versions);
  }

  if (pathname === '/api/budget-version' && method === 'POST') {
    const body = await readBody(req);
    const { year, version, version_type, status, start_date, end_date, remark } = body;
    if (!year || !version || !version_type) return send(res, 400, { error: 'year/version/version_type required' });
    // 检查是否已存在
    const [[exist]] = await pool.query('SELECT id FROM ops_budget_version WHERE year=? AND version=? AND version_type=?',
      [year, version, version_type]);
    if (exist) return send(res, 400, { error: '版本已存在' });
    const [result] = await pool.query(
      'INSERT INTO ops_budget_version (year, version, version_type, status, start_date, end_date, remark, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [year, version, version_type, status || 'draft', start_date || null, end_date || null, remark || '', getSessionUser(req)]);
    return send(res, 200, { id: result.insertId, ok: true });
  }

  if (pathname.startsWith('/api/budget-version/') && method === 'PUT') {
    const id = pathname.split('/').pop();
    const body = await readBody(req);
    const { status, start_date, end_date, remark } = body;
    const fields = [], params = [];
    if (status !== undefined) { fields.push('status=?'); params.push(status); }
    if (start_date !== undefined) { fields.push('start_date=?'); params.push(start_date); }
    if (end_date !== undefined) { fields.push('end_date=?'); params.push(end_date); }
    if (remark !== undefined) { fields.push('remark=?'); params.push(remark); }
    if (fields.length === 0) return send(res, 400, { error: 'no fields to update' });
    params.push(parseInt(id));
    await pool.query(`UPDATE ops_budget_version SET ${fields.join(',')} WHERE id=?`, params);
    return send(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/budget-version/') && method === 'DELETE') {
    const id = pathname.split('/').pop();
    // 检查是否有关联的预算数据
    const [[v]] = await pool.query('SELECT year, version, version_type FROM ops_budget_version WHERE id=?', [parseInt(id)]);
    if (v) {
      const [[cnt]] = await pool.query('SELECT COUNT(*) c FROM ops_budget_flow WHERE year=? AND version=?',
        [v.year, v.version]);
      if (cnt.c > 0) return send(res, 400, { error: '该版本已有预算数据，无法删除' });
    }
    await pool.query('DELETE FROM ops_budget_version WHERE id=?', [parseInt(id)]);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/budget-version/activate' && method === 'POST') {
    // 激活版本：将状态改为 active，同时初始化预算流数据
    const body = await readBody(req);
    const { year, version, version_type } = body;
    if (!year || !version || !version_type) return send(res, 400, { error: 'year/version/version_type required' });
    // 查找或创建版本记录
    let [[ver]] = await pool.query('SELECT * FROM ops_budget_version WHERE year=? AND version=? AND version_type=?',
      [year, version, version_type]);
    if (!ver) {
      const [r] = await pool.query('INSERT INTO ops_budget_version (year, version, version_type, status) VALUES (?,?,?,?)',
        [year, version, version_type, 'active']);
      [[ver]] = await pool.query('SELECT * FROM ops_budget_version WHERE id=?', [r.insertId]);
    } else {
      await pool.query('UPDATE ops_budget_version SET status=? WHERE id=?', ['active', ver.id]);
      ver.status = 'active';
    }
    // 初始化预算流：BD/领域/BU 层级各组织生成草稿记录
    // 获取所有组织并计算深度（从根节点开始，根=depth 1）
    const [orgRows] = await pool.query('SELECT id, name, parent_id FROM sys_org WHERE status=1 ORDER BY id');
    const nodes = {};
    orgRows.forEach(r => { nodes[r.id] = { id: r.id, name: r.name, parentId: r.parent_id, depth: 0, children: [] }; });
    const roots = [];
    orgRows.forEach(r => {
      if (r.parent_id && nodes[r.parent_id]) nodes[r.parent_id].children.push(nodes[r.id]);
      else roots.push(nodes[r.id]);
    });
    // 递归计算深度
    const calcDepth = (list, d) => { list.forEach(n => { n.depth = d; calcDepth(n.children, d + 1); }); };
    calcDepth(roots, 1);
    // 只取 BD/领域/BU（depth 3-5）
    const targetOrgs = [];
    Object.values(nodes).forEach(n => { if (n.depth >= 3 && n.depth <= 5) targetOrgs.push(n); });
    const periods = ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'YTD'];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const org of targetOrgs) {
        const level = org.depth === 3 ? 'BD' : (org.depth === 4 ? '领域' : 'BU');
        for (const period of periods) {
          await conn.query(
            `INSERT IGNORE INTO ops_budget_flow (year, version, period, org_id, level, status, source) VALUES (?,?,?,?,?,?,?)`,
            [year, version, period, org.id, level, 'draft', 'manual']);
        }
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    return send(res, 200, { version: ver, ok: true });
  }

  if (pathname === '/api/budget-version/complete' && method === 'POST') {
    // 完成版本：预估版本完成预估，目标版本确认目标
    const body = await readBody(req);
    const { year, version, version_type } = body;
    if (!year || !version || !version_type) return send(res, 400, { error: 'year/version/version_type required' });
    // 目标版本：复制为正式版
    if (version_type === 'target') {
      const [[existing]] = await pool.query('SELECT id FROM ops_budget_version WHERE year=? AND version=? AND version_type=?',
        [year, '正式版', 'target']);
      if (!existing) {
        // 复制预算流数据到正式版
        await pool.query(
          `INSERT INTO ops_budget_flow (year, version, period, org_id, level, status, source, budget_revenue, budget_profit, budget_cash, remark)
           SELECT year, '正式版', period, org_id, level, status, source, budget_revenue, budget_profit, budget_cash, remark
           FROM ops_budget_flow WHERE year=? AND version=?`,
          [year, version]);
        await pool.query(
          `INSERT INTO ops_budget_allocation (year, period, source_org_id, target_org_id, metric, ratio, target_value)
           SELECT year, period, source_org_id, target_org_id, metric, ratio, target_value
           FROM ops_budget_allocation WHERE year=?`,
          [year]);
        await pool.query(
          'INSERT INTO ops_budget_version (year, version, version_type, status, remark) VALUES (?,?,?,?,?)',
          [year, '正式版', 'target', 'completed', `由${version}生成`]);
      }
    }
    await pool.query('UPDATE ops_budget_version SET status=? WHERE year=? AND version=? AND version_type=?',
      ['completed', year, version, version_type]);
    return send(res, 200, { ok: true });
  }

  /* ---------- 目标拆分 API 结束 ---------- */
  if (pathname === '/api/target-split/batch' && method === 'POST') {
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    if (list.length === 0) return send(res, 400, { error: 'expected non-empty array' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM ops_target_split');
      let count = 0;
      for (const rec of list) {
        const db = targetApiToDb(rec);
        const cols = Object.keys(db);
        if (cols.length === 0 || !db.metric || !db.bu) continue;
        await conn.query(
          `INSERT INTO ops_target_split (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map(c => db[c])
        );
        count++;
      }
      await conn.commit();
      return send(res, 200, { count });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  if (pathname === '/api/target-split') {
    if (method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM ops_target_split ORDER BY FIELD(metric, "收入", "贡献利润", "现金流"), FIELD(bu, "软工", "硬工", "云", "智能汽车", "汇总")');
      return send(res, 200, rows.map(targetRowToApi));
    }
    if (method === 'POST' || method === 'PUT') {
      const body = await readBody(req);
      const db = targetApiToDb(body);
      if (!db.metric || !db.bu) return send(res, 400, { error: 'metric and bu required' });
      const cols = Object.keys(db);
      const updCols = cols.filter(c => c !== 'metric' && c !== 'bu');
      let sql;
      if (updCols.length > 0) {
        sql = `INSERT INTO ops_target_split (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
               ON DUPLICATE KEY UPDATE ${updCols.map(c => c + '=VALUES(' + c + ')').join(',')}`;
      } else {
        sql = `INSERT IGNORE INTO ops_target_split (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      }
      const [r] = await pool.query(sql, cols.map(c => db[c]));
      const id = r.insertId || (await pool.query('SELECT id FROM ops_target_split WHERE metric=? AND bu=?', [db.metric, db.bu]))[0][0].id;
      return send(res, 200, { _id: String(id) });
    }
  }
  const tm = pathname.match(/^\/api\/target-split\/(\d+)$/);
  if (tm) {
    const id = parseInt(tm[1], 10);
    if (method === 'PUT') {
      const body = await readBody(req);
      const db = targetApiToDb(body);
      const cols = Object.keys(db).filter(c => c !== 'metric' && c !== 'bu');
      if (cols.length === 0) return send(res, 400, { error: 'no valid fields' });
      const [r] = await pool.query(
        `UPDATE ops_target_split SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`,
        [...cols.map(c => db[c]), id]
      );
      if (r.affectedRows === 0) return send(res, 404, { error: 'not found' });
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      const [r] = await pool.query('DELETE FROM ops_target_split WHERE id=?', [id]);
      if (r.affectedRows === 0) return send(res, 404, { error: 'not found' });
      return send(res, 200, { ok: true });
    }
  }
  const fm = pathname.match(/^\/api\/forecast\/(\d+)$/);
  if (fm) {
    const id = parseInt(fm[1], 10);
    if (method === 'PUT') {
      const body = await readBody(req);
      const db = fcApiToDb(body);
      const cols = Object.keys(db).filter(c => c !== 'year' && c !== 'month');
      if (cols.length === 0) return send(res, 400, { error: 'no valid fields' });
      const [r] = await pool.query(
        `UPDATE ops_forecast SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`,
        [...cols.map(c => db[c]), id]
      );
      if (r.affectedRows === 0) return send(res, 404, { error: 'not found' });
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      const [r] = await pool.query('DELETE FROM ops_forecast WHERE id=?', [id]);
      if (r.affectedRows === 0) return send(res, 404, { error: 'not found' });
      return send(res, 200, { ok: true });
    }
  }
  if (pathname === '/api/records/batch' && method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body)) return send(res, 400, { error: 'expected array' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM ops_records');
      let count = 0;
      for (const rec of body) {
        const db = apiToDb(rec);
        const cols = Object.keys(db);
        if (cols.length === 0) continue;
        await conn.query(
          `INSERT INTO ops_records (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map(c => db[c])
        );
        count++;
      }
      await conn.commit();
      return send(res, 200, { count });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  const m = pathname.match(/^\/api\/records\/(\d+)$/);
  if (m) {
    const id = parseInt(m[1], 10);
    if (method === 'PUT') {
      const body = await readBody(req);
      const db = apiToDb(body);
      const cols = Object.keys(db);
      if (cols.length === 0) return send(res, 400, { error: 'no valid fields' });
      const [r] = await pool.query(
        `UPDATE ops_records SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`,
        [...cols.map(c => db[c]), id]
      );
      if (r.affectedRows === 0) return send(res, 404, { error: 'not found' });
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      const [r] = await pool.query('DELETE FROM ops_records WHERE id=?', [id]);
      if (r.affectedRows === 0) return send(res, 404, { error: 'not found' });
      return send(res, 200, { ok: true });
    }
  }
  /* ================= 数据表管理 API ================= */
  // 树形结构: 分类 + 业务表 (含字段数/审批状态)
  if (pathname === '/api/table-meta/tree' && method === 'GET') {
    const [metas] = await pool.query('SELECT * FROM ops_table_meta ORDER BY type ASC, id ASC');
    const [fcnt] = await pool.query('SELECT table_meta_id, COUNT(*) AS c FROM ops_table_field GROUP BY table_meta_id');
    const fcntMap = {};
    fcnt.forEach(r => { fcntMap[r.table_meta_id] = r.c; });
    const nodes = {};
    metas.forEach(m => {
      nodes[m.id] = {
        id: m.id, name: m.name, type: m.type, parentId: m.parent_id, tableName: m.table_name,
        description: m.description, status: m.status, fieldCount: m.type === 'table' ? (fcntMap[m.id] || 0) : 0, children: []
      };
    });
    const roots = [];
    metas.forEach(m => {
      const node = nodes[m.id];
      if (node.parentId && nodes[node.parentId]) nodes[node.parentId].children.push(node);
      else roots.push(node);
    });
    return send(res, 200, roots);
  }
  // 创建分类或业务表: {name, type, parentId, tableName?, description?}
  if (pathname === '/api/table-meta' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const type = String(body.type || 'table');
    const parentId = body.parentId ? parseInt(body.parentId, 10) : null;
    const tableName = type === 'table' ? String(body.tableName || '').trim() : null;
    if (!name) return send(res, 400, { error: 'name required' });
    if (type === 'table' && !tableName) return send(res, 400, { error: 'tableName required for table' });
    // 同级重名校验
    const [dup] = await pool.query('SELECT id FROM ops_table_meta WHERE name=? AND ((parent_id=? ) OR (parent_id IS NULL AND ? IS NULL))', [name, parentId, parentId]);
    if (dup.length > 0) return send(res, 400, { error: '同级已存在同名节点: ' + name });
    if (type === 'table') {
      const [dupT] = await pool.query('SELECT id FROM ops_table_meta WHERE table_name=?', [tableName]);
      if (dupT.length > 0) return send(res, 400, { error: '物理表名已被占用: ' + tableName });
    }
    const [r] = await pool.query(
      'INSERT INTO ops_table_meta (name, type, parent_id, table_name, description, status, created_by) VALUES (?,?,?,?,?,?,?)',
      [name, type, parentId, tableName, String(body.description || ''), type === 'table' ? 'draft' : 'active', 'admin']
    );
    if (type === 'table') await addTableLog(r.insertId, 'create', '创建业务表定义: ' + name + ' (物理表 ' + tableName + ')');
    else await addTableLog(r.insertId, 'create_category', '创建分类: ' + name);
    return send(res, 201, { _id: String(r.insertId) });
  }
  const tmm = pathname.match(/^\/api\/table-meta\/(\d+)$/);
  if (tmm) {
    const id = parseInt(tmm[1], 10);
    const [[meta]] = await pool.query('SELECT * FROM ops_table_meta WHERE id=?', [id]);
    if (!meta) return send(res, 404, { error: 'not found' });
    if (method === 'GET') {
      const [fields] = await pool.query('SELECT * FROM ops_table_field WHERE table_meta_id=? ORDER BY field_order ASC, id ASC', [id]);
      return send(res, 200, {
        id: meta.id, name: meta.name, type: meta.type, parentId: meta.parent_id,
        tableName: meta.table_name, description: meta.description, status: meta.status,
        createdBy: meta.created_by, createdAt: meta.created_at, updatedAt: meta.updated_at,
        fields: fields.map(f => ({
          id: f.id, fieldName: f.field_name, displayName: f.display_name, dataType: f.data_type,
          length: f.length, nullable: !!f.nullable, defaultValue: f.default_value, comment: f.comment,
          isPk: !!f.is_pk, isUnique: !!f.is_unique, isIndex: !!f.is_index,
          fkTable: f.fk_table, fkField: f.fk_field, fieldOrder: f.field_order
        }))
      });
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      if (meta.status === 'pending' || meta.status === 'approved') return send(res, 400, { error: '审批中/已通过的表不可编辑' });
      const name = String(body.name || meta.name).trim();
      const tableName = meta.type === 'table' ? String(body.tableName || meta.table_name || '').trim() : meta.table_name;
      const [dup] = await pool.query('SELECT id FROM ops_table_meta WHERE id<>? AND name=? AND ((parent_id=? ) OR (parent_id IS NULL AND ? IS NULL))', [id, name, meta.parent_id, meta.parent_id]);
      if (dup.length > 0) return send(res, 400, { error: '同级已存在同名节点: ' + name });
      if (meta.type === 'table' && tableName && tableName !== meta.table_name) {
        const [dupT] = await pool.query('SELECT id FROM ops_table_meta WHERE id<>? AND table_name=?', [id, tableName]);
        if (dupT.length > 0) return send(res, 400, { error: '物理表名已被占用: ' + tableName });
      }
      await pool.query(
        'UPDATE ops_table_meta SET name=?, table_name=?, description=?, status=? WHERE id=?',
        [name, tableName, String(body.description !== undefined ? body.description : meta.description), body.status || meta.status, id]
      );
      await addTableLog(id, 'update', '更新表定义: ' + name);
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      if (meta.type === 'table' && (meta.status === 'approved' || meta.status === 'pending_drop')) return send(res, 400, { error: '已审批通过的表不可直接删除, 请走「下线审批」流程' });
      // 级联删除: 收集该节点及其所有后代
      const allIds = [id];
      let frontier = [id];
      while (frontier.length > 0) {
        const [kids] = await pool.query('SELECT id FROM ops_table_meta WHERE parent_id IN (?)', [frontier]);
        frontier = kids.map(k => k.id);
        allIds.push(...frontier);
      }
      const ids = allIds.filter((v, i) => allIds.indexOf(v) === i);
      const ph = ids.map(() => '?').join(',');
      await pool.query('DELETE FROM ops_table_meta WHERE id IN (' + ph + ')', ids);
      await pool.query('DELETE FROM ops_table_field WHERE table_meta_id IN (' + ph + ')', ids);
      await pool.query('DELETE FROM ops_table_approval WHERE table_meta_id IN (' + ph + ')', ids);
      await pool.query('DELETE FROM ops_table_log WHERE table_meta_id IN (' + ph + ')', ids);
      return send(res, 200, { ok: true, deleted: ids.length });
    }
  }
  // 字段管理
  const tfm = pathname.match(/^\/api\/table-meta\/(\d+)\/fields(?:\/(\d+))?$/);
  if (tfm) {
    const id = parseInt(tfm[1], 10);
    const fid = tfm[2] ? parseInt(tfm[2], 10) : null;
    const [[meta]] = await pool.query('SELECT * FROM ops_table_meta WHERE id=?', [id]);
    if (!meta || meta.type !== 'table') return send(res, 404, { error: 'table meta not found' });
    if (method === 'POST') {
      if (meta.status === 'pending' || meta.status === 'approved') return send(res, 400, { error: '审批中/已通过的表不可编辑字段' });
      const body = await readBody(req);
      const fieldName = String(body.fieldName || '').trim();
      const dataType = String(body.dataType || '');
      if (!fieldName || !dataType) return send(res, 400, { error: 'fieldName and dataType required' });
      const [dup] = await pool.query('SELECT id FROM ops_table_field WHERE table_meta_id=? AND field_name=?', [id, fieldName]);
      if (dup.length > 0) return send(res, 400, { error: '字段已存在: ' + fieldName });
      const [r] = await pool.query(
        'INSERT INTO ops_table_field (table_meta_id, field_name, display_name, data_type, length, nullable, default_value, comment, is_pk, is_unique, is_index, fk_table, fk_field, field_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, fieldName, String(body.displayName || ''), dataType, body.length != null ? parseInt(body.length, 10) : null,
         body.nullable ? 1 : 0, body.defaultValue != null ? String(body.defaultValue) : null, String(body.comment || ''),
         body.isPk ? 1 : 0, body.isUnique ? 1 : 0, body.isIndex ? 1 : 0,
         body.fkTable ? String(body.fkTable) : null, body.fkField ? String(body.fkField) : null,
         body.fieldOrder != null ? parseInt(body.fieldOrder, 10) : 0]
      );
      await addTableLog(id, 'add_field', '新增字段: ' + fieldName + ' ' + dataType + (body.length ? '(' + body.length + ')' : ''));
      return send(res, 201, { _id: String(r.insertId) });
    }
    if (fid && method === 'PUT') {
      if (meta.status === 'pending' || meta.status === 'approved') return send(res, 400, { error: '审批中/已通过的表不可编辑字段' });
      const body = await readBody(req);
      const [[f]] = await pool.query('SELECT * FROM ops_table_field WHERE id=? AND table_meta_id=?', [fid, id]);
      if (!f) return send(res, 404, { error: 'field not found' });
      const fieldName = String(body.fieldName || f.field_name).trim();
      const [dup] = await pool.query('SELECT id FROM ops_table_field WHERE table_meta_id=? AND field_name=? AND id<>?', [id, fieldName, fid]);
      if (dup.length > 0) return send(res, 400, { error: '字段已存在: ' + fieldName });
      await pool.query(
        'UPDATE ops_table_field SET field_name=?, display_name=?, data_type=?, length=?, nullable=?, default_value=?, comment=?, is_pk=?, is_unique=?, is_index=?, fk_table=?, fk_field=?, field_order=? WHERE id=?',
        [fieldName, String(body.displayName !== undefined ? body.displayName : f.display_name),
         String(body.dataType || f.data_type), body.length != null ? parseInt(body.length, 10) : f.length,
         body.nullable !== undefined ? (body.nullable ? 1 : 0) : f.nullable,
         body.defaultValue !== undefined ? (body.defaultValue != null ? String(body.defaultValue) : null) : f.default_value,
         String(body.comment !== undefined ? body.comment : f.comment),
         body.isPk !== undefined ? (body.isPk ? 1 : 0) : f.is_pk,
         body.isUnique !== undefined ? (body.isUnique ? 1 : 0) : f.is_unique,
         body.isIndex !== undefined ? (body.isIndex ? 1 : 0) : f.is_index,
         body.fkTable !== undefined ? (body.fkTable ? String(body.fkTable) : null) : f.fk_table,
         body.fkField !== undefined ? (body.fkField ? String(body.fkField) : null) : f.fk_field,
         body.fieldOrder != null ? parseInt(body.fieldOrder, 10) : f.field_order,
         fid]
      );
      await addTableLog(id, 'update_field', '修改字段: ' + fieldName);
      return send(res, 200, { ok: true });
    }
    if (fid && method === 'DELETE') {
      if (meta.status === 'pending' || meta.status === 'approved') return send(res, 400, { error: '审批中/已通过的表不可编辑字段' });
      const [[f]] = await pool.query('SELECT * FROM ops_table_field WHERE id=? AND table_meta_id=?', [fid, id]);
      if (!f) return send(res, 404, { error: 'field not found' });
      await pool.query('DELETE FROM ops_table_field WHERE id=?', [fid]);
      await addTableLog(id, 'delete_field', '删除字段: ' + f.field_name);
      return send(res, 200, { ok: true });
    }
  }
  // 审批流程
  const tsub = pathname.match(/^\/api\/table-meta\/(\d+)\/(submit|approve|reject|ddl|execute)$/);
  if (tsub) {
    const id = parseInt(tsub[1], 10);
    const action = tsub[2];
    const [[meta]] = await pool.query('SELECT * FROM ops_table_meta WHERE id=?', [id]);
    if (!meta || meta.type !== 'table') return send(res, 404, { error: 'table meta not found' });
    if (method === 'POST') {
      const body = await readBody(req);
      const comment = String(body.comment || '');
      if (action === 'submit') {
        if (meta.status === 'pending') return send(res, 400, { error: '已提交审批, 请等待审批结果' });
        const dropReq = body.action === 'drop';
        if (dropReq) {
          // 下线申请: 仅已审批通过(物理表已建)的表可申请
          if (meta.status !== 'approved') return send(res, 400, { error: '仅已审批通过的表可申请下线删除' });
          const [pending] = await pool.query("SELECT id FROM ops_table_approval WHERE table_meta_id=? AND status='pending'", [id]);
          if (pending.length > 0) return send(res, 400, { error: '存在未完成的审批单' });
          await pool.query('UPDATE ops_table_meta SET status=? WHERE id=?', ['pending', id]);
          await pool.query('INSERT INTO ops_table_approval (table_meta_id, action, status, applicant, comment, snapshot) VALUES (?,?,?,?,?,?)',
            [id, 'drop', 'pending', 'admin', comment, JSON.stringify({ tableName: meta.table_name, name: meta.name, drop: true })]);
          await addTableLog(id, 'submit_drop', '申请下线删除: ' + meta.name);
          return send(res, 200, { ok: true, status: 'pending', action: 'drop' });
        }
        const [fields] = await pool.query('SELECT * FROM ops_table_field WHERE table_meta_id=? ORDER BY field_order ASC, id ASC', [id]);
        if (fields.length === 0) return send(res, 400, { error: '至少需要一个字段才能提交审批' });
        const [pending] = await pool.query("SELECT id FROM ops_table_approval WHERE table_meta_id=? AND status='pending'", [id]);
        if (pending.length > 0) return send(res, 400, { error: '存在未完成的审批单' });
        await pool.query('UPDATE ops_table_meta SET status=? WHERE id=?', ['pending', id]);
        await pool.query('INSERT INTO ops_table_approval (table_meta_id, action, status, applicant, comment, snapshot) VALUES (?,?,?,?,?,?)',
          [id, 'create', 'pending', 'admin', comment, JSON.stringify({ tableName: meta.table_name, name: meta.name, fields: fields.map(f => ({ field_name: f.field_name, data_type: f.data_type, length: f.length })) })]);
        await addTableLog(id, 'submit', '提交审批: ' + meta.name);
        return send(res, 200, { ok: true, status: 'pending' });
      }
      if (action === 'approve') {
        if (meta.status !== 'pending') return send(res, 400, { error: '当前状态不可审批 (仅审批中可审批)' });
        const [[ap]] = await pool.query("SELECT action FROM ops_table_approval WHERE table_meta_id=? AND status='pending' ORDER BY id DESC LIMIT 1", [id]);
        const apAction = ap ? ap.action : 'create';
        await pool.query("UPDATE ops_table_approval SET status='approved', approver=?, comment=CONCAT(IFNULL(comment,''), IF(?<>'', CONCAT('\n审批意见: ', ?), '')), resolved_at=NOW() WHERE table_meta_id=? AND status='pending'",
          ['admin', comment, comment, id]);
        await pool.query("UPDATE ops_table_meta SET status=? WHERE id=?", [apAction === 'drop' ? 'pending_drop' : 'approved', id]);
        await addTableLog(id, 'approve', (apAction === 'drop' ? '下线审批通过: ' : '审批通过: ') + meta.name + (comment ? ' (' + comment + ')' : ''));
        return send(res, 200, { ok: true, status: apAction === 'drop' ? 'pending_drop' : 'approved', action: apAction });
      }
      if (action === 'reject') {
        if (meta.status !== 'pending') return send(res, 400, { error: '当前状态不可审批 (仅审批中可审批)' });
        const [[ap]] = await pool.query("SELECT action FROM ops_table_approval WHERE table_meta_id=? AND status='pending' ORDER BY id DESC LIMIT 1", [id]);
        const apAction = ap ? ap.action : 'create';
        await pool.query("UPDATE ops_table_approval SET status='rejected', approver=?, comment=CONCAT(IFNULL(comment,''), IF(?<>'', CONCAT('\n审批意见: ', ?), '')), resolved_at=NOW() WHERE table_meta_id=? AND status='pending'",
          ['admin', comment, comment, id]);
        await pool.query("UPDATE ops_table_meta SET status=? WHERE id=?", [apAction === 'drop' ? 'approved' : 'rejected', id]);
        await addTableLog(id, 'reject', (apAction === 'drop' ? '下线审批驳回: ' : '审批驳回: ') + meta.name + (comment ? ' (' + comment + ')' : ''));
        return send(res, 200, { ok: true, status: apAction === 'drop' ? 'approved' : 'rejected' });
      }
      if (action === 'execute') {
        const dropReq = body.action === 'drop';
        if (dropReq) {
          if (meta.status !== 'pending_drop') return send(res, 400, { error: '下线审批通过后才可执行删除' });
          await pool.query('DROP TABLE IF EXISTS `' + meta.table_name + '`');
          await addTableLog(id, 'execute_drop', '已执行 DROP 删除物理表: ' + meta.table_name);
          await pool.query('DELETE FROM ops_table_meta WHERE id=?', [id]);
          return send(res, 200, { ok: true, dropped: true });
        }
        if (meta.status !== 'approved') return send(res, 400, { error: '审批通过后才可执行 DDL 建表' });
        const [fields] = await pool.query('SELECT * FROM ops_table_field WHERE table_meta_id=? ORDER BY field_order ASC, id ASC', [id]);
        const ddl = genTableDDL(meta, fields);
        await pool.query(ddl);
        await addTableLog(id, 'execute', '已执行 DDL 创建物理表: ' + meta.table_name);
        return send(res, 200, { ok: true, executed: true, ddl });
      }
    }
    if (action === 'ddl' && method === 'GET') {
      const [fields] = await pool.query('SELECT * FROM ops_table_field WHERE table_meta_id=? ORDER BY field_order ASC, id ASC', [id]);
      const ddl = genTableDDL(meta, fields);
      return send(res, 200, { ddl });
    }
  }
  // 审批历史 + 操作日志
  const tlog = pathname.match(/^\/api\/table-meta\/(\d+)\/(approvals|logs)$/);
  if (tlog && method === 'GET') {
    const id = parseInt(tlog[1], 10);
    if (tlog[2] === 'approvals') {
      const [rows] = await pool.query('SELECT * FROM ops_table_approval WHERE table_meta_id=? ORDER BY id DESC', [id]);
      return send(res, 200, rows.map(r => ({
        id: r.id, action: r.action, status: r.status, applicant: r.applicant, approver: r.approver,
        comment: r.comment, snapshot: r.snapshot, createdAt: r.created_at, resolvedAt: r.resolved_at
      })));
    }
    const [rows] = await pool.query('SELECT * FROM ops_table_log WHERE table_meta_id=? ORDER BY id DESC', [id]);
    return send(res, 200, rows.map(r => ({
      id: r.id, action: r.action, detail: r.detail, operator: r.operator, createdAt: r.created_at
    })));
  }
  /* ================= 后台管理 (仅 admin) ================= */
  if (pathname.startsWith('/api/admin/')) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;   // requireAdmin 已输出 401/403

    /* ---- 用户管理 ---- */
    if (pathname === '/api/admin/users' && method === 'GET') {
      const q = new URL(req.url, 'http://x');
      const page = Math.max(parseInt(q.searchParams.get('page'), 10) || 1, 1);
      const size = Math.min(Math.max(parseInt(q.searchParams.get('size'), 10) || 10, 1), 100);
      const keyword = String(q.searchParams.get('keyword') || '').trim();
      const status = q.searchParams.get('status');
      let where = ' WHERE 1=1';
      const params = [];
      if (keyword) { where += ' AND (u.username LIKE ? OR u.real_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'; const k = '%' + keyword + '%'; params.push(k, k, k, k); }
      if (status === '0' || status === '1') { where += ' AND u.status=?'; params.push(parseInt(status, 10)); }
      const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM sys_user u' + where, params);
      const [rows] = await pool.query(
        `SELECT u.id, u.username, u.real_name, u.email, u.phone, u.org_id, u.status, u.created_at,
                o.name AS org_name FROM sys_user u LEFT JOIN sys_org o ON o.id = u.org_id` + where +
        ' ORDER BY u.id ASC LIMIT ? OFFSET ?',
        params.concat([size, (page - 1) * size]));
      const list = [];
      for (const r of rows) {
        const roles = await getUserRoles(r.id);
        list.push({
          id: r.id, username: r.username, realName: r.real_name, email: r.email, phone: r.phone,
          orgId: r.org_id, orgName: r.org_name, status: r.status, createdAt: r.created_at,
          roles: roles.map(x => x.name), roleCodes: roles.map(x => x.code)
        });
      }
      return send(res, 200, { total, page, size, list });
    }
    if (pathname === '/api/admin/users' && method === 'POST') {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const realName = String(body.realName || '').trim();
      const email = String(body.email || '').trim();
      const phone = String(body.phone || '').trim();
      const orgId = body.orgId ? parseInt(body.orgId, 10) : null;
      if (!username || !/^[a-zA-Z0-9_]{2,32}$/.test(username)) return send(res, 400, { error: '用户名需为 2-32 位字母/数字/下划线' });
      if (!password || password.length < 6) return send(res, 400, { error: '密码至少 6 位' });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: '邮箱格式不正确' });
      const [dup] = await pool.query('SELECT id FROM sys_user WHERE username=?', [username]);
      if (dup.length > 0) return send(res, 400, { error: '用户名已存在: ' + username });
      const salt = genSalt();
      const [r] = await pool.query(
        'INSERT INTO sys_user (username, password, salt, real_name, email, phone, org_id, status) VALUES (?,?,?,?,?,?,?,1)',
        [username, hashPassword(password, salt), salt, realName, email, phone, orgId]);
      const roleIds = Array.isArray(body.roleIds) ? body.roleIds.map(x => parseInt(x, 10)).filter(x => x) : [];
      for (const rid of roleIds) await pool.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [r.insertId, rid]);
      return send(res, 201, { _id: String(r.insertId) });
    }
    const uIdm = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (uIdm) {
      const uid = parseInt(uIdm[1], 10);
      const [[user]] = await pool.query('SELECT * FROM sys_user WHERE id=?', [uid]);
      if (!user) return send(res, 404, { error: '用户不存在' });
      if (method === 'PUT') {
        const body = await readBody(req);
        if (uid === admin.id && body.status === 0) return send(res, 400, { error: '不能禁用当前登录账号' });
        const realName = String(body.realName != null ? body.realName : user.real_name).trim();
        const email = String(body.email != null ? body.email : user.email).trim();
        const phone = String(body.phone != null ? body.phone : user.phone).trim();
        const orgId = body.orgId != null ? (parseInt(body.orgId, 10) || null) : user.org_id;
        const status = body.status != null ? (parseInt(body.status, 10) === 0 ? 0 : 1) : user.status;
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: '邮箱格式不正确' });
        await pool.query('UPDATE sys_user SET real_name=?, email=?, phone=?, org_id=?, status=? WHERE id=?', [realName, email, phone, orgId, status, uid]);
        if (Array.isArray(body.roleIds)) {
          const roleIds = body.roleIds.map(x => parseInt(x, 10)).filter(x => x);
          await pool.query('DELETE FROM sys_user_role WHERE user_id=?', [uid]);
          for (const rid of roleIds) await pool.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [uid, rid]);
        }
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        if (uid === admin.id) return send(res, 400, { error: '不能删除当前登录账号' });
        await pool.query('DELETE FROM sys_session WHERE user_id=?', [uid]);
        await pool.query('DELETE FROM sys_user_role WHERE user_id=?', [uid]);
        await pool.query('DELETE FROM sys_user WHERE id=?', [uid]);
        return send(res, 200, { ok: true });
      }
    }
    const uStatusM = pathname.match(/^\/api\/admin\/users\/(\d+)\/status$/);
    if (uStatusM && method === 'PUT') {
      const uid = parseInt(uStatusM[1], 10);
      const body = await readBody(req);
      const status = parseInt(body.status, 10) === 0 ? 0 : 1;
      if (uid === admin.id && status === 0) return send(res, 400, { error: '不能禁用当前登录账号' });
      const [r] = await pool.query('UPDATE sys_user SET status=? WHERE id=?', [status, uid]);
      if (r.affectedRows === 0) return send(res, 404, { error: '用户不存在' });
      if (status === 0) await pool.query('DELETE FROM sys_session WHERE user_id=?', [uid]);
      return send(res, 200, { ok: true });
    }
    const uPwdM = pathname.match(/^\/api\/admin\/users\/(\d+)\/password$/);
    if (uPwdM && method === 'PUT') {
      const uid = parseInt(uPwdM[1], 10);
      const body = await readBody(req);
      const pwd = String(body.password || '');
      if (pwd.length < 6) return send(res, 400, { error: '密码至少 6 位' });
      const salt = genSalt();
      const [r] = await pool.query('UPDATE sys_user SET password=?, salt=? WHERE id=?', [hashPassword(pwd, salt), salt, uid]);
      if (r.affectedRows === 0) return send(res, 404, { error: '用户不存在' });
      await pool.query('DELETE FROM sys_session WHERE user_id=?', [uid]);
      return send(res, 200, { ok: true });
    }
    const uRoleM = pathname.match(/^\/api\/admin\/users\/(\d+)\/roles$/);
    if (uRoleM) {
      const uid = parseInt(uRoleM[1], 10);
      if (method === 'GET') {
        const roles = await getUserRoles(uid);
        return send(res, 200, { roleIds: roles.map(r => r.id), roles });
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const roleIds = Array.isArray(body.roleIds) ? body.roleIds.map(x => parseInt(x, 10)).filter(x => x) : [];
        await pool.query('DELETE FROM sys_user_role WHERE user_id=?', [uid]);
        for (const rid of roleIds) await pool.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [uid, rid]);
        return send(res, 200, { ok: true });
      }
    }

    /* ---- 角色管理 ---- */
    if (pathname === '/api/admin/roles' && method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM sys_role ORDER BY id ASC');
      const list = [];
      for (const r of rows) {
        const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_user_role WHERE role_id=?', [r.id]);
        const [[{ pc }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_role_permission WHERE role_id=?', [r.id]);
        list.push({ id: r.id, name: r.name, code: r.code, description: r.description, status: r.status, userCount: c, permCount: pc });
      }
      return send(res, 200, list);
    }
    if (pathname === '/api/admin/roles' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const code = String(body.code || '').trim();
      if (!name || !code) return send(res, 400, { error: '角色名称和编码必填' });
      if (!/^[a-zA-Z0-9_]{2,32}$/.test(code)) return send(res, 400, { error: '角色编码需为 2-32 位字母/数字/下划线' });
      const [dup] = await pool.query('SELECT id FROM sys_role WHERE code=?', [code]);
      if (dup.length > 0) return send(res, 400, { error: '角色编码已存在: ' + code });
      const [r] = await pool.query('INSERT INTO sys_role (name, code, description) VALUES (?,?,?)', [name, code, String(body.description || '')]);
      if (Array.isArray(body.permIds)) {
        for (const pid of body.permIds.map(x => parseInt(x, 10)).filter(x => x)) await pool.query('INSERT IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (?,?)', [r.insertId, pid]);
      }
      return send(res, 201, { _id: String(r.insertId) });
    }
    const rIdm = pathname.match(/^\/api\/admin\/roles\/(\d+)$/);
    if (rIdm) {
      const rid = parseInt(rIdm[1], 10);
      const [[role]] = await pool.query('SELECT * FROM sys_role WHERE id=?', [rid]);
      if (!role) return send(res, 404, { error: '角色不存在' });
      if (method === 'PUT') {
        const body = await readBody(req);
        const name = String(body.name != null ? body.name : role.name).trim();
        const code = String(body.code != null ? body.code : role.code).trim();
        if (!name || !code) return send(res, 400, { error: '角色名称和编码必填' });
        const [dup] = await pool.query('SELECT id FROM sys_role WHERE code=? AND id<>?', [code, rid]);
        if (dup.length > 0) return send(res, 400, { error: '角色编码已存在: ' + code });
        await pool.query('UPDATE sys_role SET name=?, code=?, description=?, status=? WHERE id=?', [name, code, String(body.description != null ? body.description : role.description), body.status != null ? (parseInt(body.status, 10) === 0 ? 0 : 1) : role.status, rid]);
        if (Array.isArray(body.permIds)) {
          const permIds = body.permIds.map(x => parseInt(x, 10)).filter(x => x);
          await pool.query('DELETE FROM sys_role_permission WHERE role_id=?', [rid]);
          for (const pid of permIds) await pool.query('INSERT IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (?,?)', [rid, pid]);
        }
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_user_role WHERE role_id=?', [rid]);
        if (c > 0) return send(res, 400, { error: '该角色已分配给 ' + c + ' 个用户，请先解除分配' });
        if (role.code === 'admin') return send(res, 400, { error: '内置管理员角色不可删除' });
        await pool.query('DELETE FROM sys_role_permission WHERE role_id=?', [rid]);
        await pool.query('DELETE FROM sys_role WHERE id=?', [rid]);
        return send(res, 200, { ok: true });
      }
    }
    const rPermM = pathname.match(/^\/api\/admin\/roles\/(\d+)\/permissions$/);
    if (rPermM) {
      const rid = parseInt(rPermM[1], 10);
      if (method === 'GET') {
        const [rows] = await pool.query('SELECT permission_id FROM sys_role_permission WHERE role_id=?', [rid]);
        return send(res, 200, { permIds: rows.map(r => r.permission_id) });
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const permIds = Array.isArray(body.permIds) ? body.permIds.map(x => parseInt(x, 10)).filter(x => x) : [];
        await pool.query('DELETE FROM sys_role_permission WHERE role_id=?', [rid]);
        for (const pid of permIds) await pool.query('INSERT IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (?,?)', [rid, pid]);
        return send(res, 200, { ok: true });
      }
    }
    const rUserM = pathname.match(/^\/api\/admin\/roles\/(\d+)\/users$/);
    if (rUserM) {
      const rid = parseInt(rUserM[1], 10);
      if (method === 'GET') {
        const [rows] = await pool.query(
          `SELECT u.id, u.username, u.real_name, u.status FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id WHERE ur.role_id=? ORDER BY u.id`, [rid]);
        return send(res, 200, rows.map(r => ({ id: r.id, username: r.username, realName: r.real_name, status: r.status })));
      }
      if (method === 'PUT') {
        // 设置角色的用户集合: {userIds:[...]} (勾选=加入, 未勾选=移除)
        const body = await readBody(req);
        const userIds = Array.isArray(body.userIds) ? body.userIds.map(x => parseInt(x, 10)).filter(x => x) : [];
        await pool.query('DELETE FROM sys_user_role WHERE role_id=?', [rid]);
        for (const uid of userIds) await pool.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [uid, rid]);
        return send(res, 200, { ok: true, count: userIds.length });
      }
    }

    /* ---- 权限管理 ---- */
    if (pathname === '/api/admin/permissions' && method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM sys_permission ORDER BY sort ASC, id ASC');
      const nodes = {};
      rows.forEach(r => { nodes[r.id] = { id: r.id, name: r.name, code: r.code, type: r.type, parentId: r.parent_id, sort: r.sort }; });
      const roots = [];
      rows.forEach(r => {
        const node = nodes[r.id];
        node.children = nodes[r.id].children || [];
        if (r.parent_id && nodes[r.parent_id]) { nodes[r.parent_id].children = nodes[r.parent_id].children || []; nodes[r.parent_id].children.push(node); }
        else roots.push(node);
      });
      return send(res, 200, roots);
    }
    if (pathname === '/api/admin/permissions' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const code = String(body.code || '').trim();
      const type = String(body.type || 'menu');
      if (!name || !code) return send(res, 400, { error: '权限名称和编码必填' });
      const parentId = body.parentId ? parseInt(body.parentId, 10) : null;
      const [dup] = await pool.query('SELECT id FROM sys_permission WHERE code=?', [code]);
      if (dup.length > 0) return send(res, 400, { error: '权限编码已存在: ' + code });
      const [r] = await pool.query('INSERT INTO sys_permission (name, code, type, parent_id, sort) VALUES (?,?,?,?,?)',
        [name, code, type, parentId, parseInt(body.sort, 10) || 0]);
      return send(res, 201, { _id: String(r.insertId) });
    }
    const pIdm = pathname.match(/^\/api\/admin\/permissions\/(\d+)$/);
    if (pIdm) {
      const pid = parseInt(pIdm[1], 10);
      const [[perm]] = await pool.query('SELECT * FROM sys_permission WHERE id=?', [pid]);
      if (!perm) return send(res, 404, { error: '权限不存在' });
      if (method === 'PUT') {
        const body = await readBody(req);
        const name = String(body.name != null ? body.name : perm.name).trim();
        const code = String(body.code != null ? body.code : perm.code).trim();
        if (!name || !code) return send(res, 400, { error: '权限名称和编码必填' });
        const [dup] = await pool.query('SELECT id FROM sys_permission WHERE code=? AND id<>?', [code, pid]);
        if (dup.length > 0) return send(res, 400, { error: '权限编码已存在: ' + code });
        await pool.query('UPDATE sys_permission SET name=?, code=?, type=?, parent_id=?, sort=? WHERE id=?',
          [name, code, String(body.type != null ? body.type : perm.type), body.parentId != null ? (parseInt(body.parentId, 10) || null) : perm.parent_id, body.sort != null ? (parseInt(body.sort, 10) || 0) : perm.sort, pid]);
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_permission WHERE parent_id=?', [pid]);
        if (c > 0) return send(res, 400, { error: '存在子权限，请先删除子权限' });
        await pool.query('DELETE FROM sys_role_permission WHERE permission_id=?', [pid]);
        await pool.query('DELETE FROM sys_permission WHERE id=?', [pid]);
        return send(res, 200, { ok: true });
      }
    }

    /* ---- 组织分支模板管理 ---- */
    if (pathname === '/api/admin/org-templates' && method === 'GET') {
      const [[cfg]] = await pool.query("SELECT cfg_value FROM sys_org_config WHERE cfg_key='fixed_levels'");
      let fixed = ORG_FIXED_LEVELS;
      try { if (cfg && cfg.cfg_value) fixed = JSON.parse(cfg.cfg_value); } catch (e) {}
      const [rows] = await pool.query('SELECT * FROM sys_org_template ORDER BY id ASC');
      const list = [];
      for (const r of rows) {
        const levels = parseJsonArr(r.levels);
        const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_org WHERE template_id=?', [r.id]);
        list.push({ id: r.id, name: r.name, levels: levels, description: r.description, refCount: c, createdAt: r.created_at });
      }
      return send(res, 200, { templates: list, fixedLevels: fixed });
    }
    if (pathname === '/api/admin/org-templates' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const levels = Array.isArray(body.levels) ? body.levels.map(String).map(s => s.trim()).filter(Boolean) : [];
      if (!name) return send(res, 400, { error: '模板名称必填' });
      if (!levels.length) return send(res, 400, { error: '层级列表不能为空' });
      const [dup] = await pool.query('SELECT id FROM sys_org_template WHERE name=?', [name]);
      if (dup.length > 0) return send(res, 400, { error: '模板名称已存在: ' + name });
      const [r] = await pool.query('INSERT INTO sys_org_template (name, levels, description) VALUES (?,?,?)',
        [name, JSON.stringify(levels), String(body.description || '')]);
      return send(res, 201, { _id: String(r.insertId) });
    }
    const tIdm = pathname.match(/^\/api\/admin\/org-templates\/(\d+)$/);
    if (tIdm) {
      const tid = parseInt(tIdm[1], 10);
      const [[tpl]] = await pool.query('SELECT * FROM sys_org_template WHERE id=?', [tid]);
      if (!tpl) return send(res, 404, { error: '模板不存在' });
      if (method === 'PUT') {
        const body = await readBody(req);
        const name = String(body.name != null ? body.name : tpl.name).trim();
        const levels = Array.isArray(body.levels) ? body.levels.map(String).map(s => s.trim()).filter(Boolean) : null;
        if (!name) return send(res, 400, { error: '模板名称必填' });
        if (levels !== null && !levels.length) return send(res, 400, { error: '层级列表不能为空' });
        const [dup] = await pool.query('SELECT id FROM sys_org_template WHERE id<>? AND name=?', [tid, name]);
        if (dup.length > 0) return send(res, 400, { error: '模板名称已存在: ' + name });
        await pool.query('UPDATE sys_org_template SET name=?, levels=?, description=? WHERE id=?',
          [name, levels !== null ? JSON.stringify(levels) : jsonStr(tpl.levels), body.description != null ? String(body.description) : tpl.description, tid]);
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_org WHERE template_id=?', [tid]);
        if (c > 0) return send(res, 400, { error: '该模板正被 ' + c + ' 个组织引用，请先解除引用' });
        await pool.query('DELETE FROM sys_org_template WHERE id=?', [tid]);
        return send(res, 200, { ok: true });
      }
    }

    /* ---- 组织结构管理 ---- */
    if (pathname === '/api/admin/orgs' && method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM sys_org ORDER BY sort ASC, id ASC');
      const [[cfg]] = await pool.query("SELECT cfg_value FROM sys_org_config WHERE cfg_key='fixed_levels'");
      let FIXED = ORG_FIXED_LEVELS;
      try { if (cfg && cfg.cfg_value) FIXED = JSON.parse(cfg.cfg_value); } catch (e) {}
      const [trows] = await pool.query('SELECT id, name, levels FROM sys_org_template');
      const TPL = {}, TPL_NAMES = {};
      trows.forEach(t => { TPL[t.id] = parseJsonArr(t.levels); TPL_NAMES[t.id] = t.name; });
      const nodes = {};
      rows.forEach(r => {
        nodes[r.id] = { id: r.id, name: r.name, parentId: r.parent_id, type: r.type, sort: r.sort, status: r.status,
          templateId: r.template_id, levelName: r.level_name, tplLevel: r.tpl_level, depth: 0, levelLabel: '', templateName: null, children: [] };
      });
      const roots = [];
      rows.forEach(r => {
        const node = nodes[r.id];
        if (r.parent_id && nodes[r.parent_id]) nodes[r.parent_id].children.push(node);
        else roots.push(node);
      });
      // 深度 + 模板继承 + 层级名推导:
      //   depth≤3 固定层(FIXED[depth-1]); depth≥4 模板层——
      //     自身 tpl_level 优先 → 模板.levels[tpl_level]（支持跳层）
      //     否则继承父节点推导层级 +1（父无则 0），即按链顺延
      //   level_name 覆盖始终最高优先
      (function walk(list, depth, tplId, tplName, parentLvIdx){
        for (const n of list) {
          n.depth = depth;
          const curTpl = n.templateId != null ? n.templateId : tplId;
          const curName = n.templateId != null ? (TPL_NAMES[n.templateId] || null) : tplName;
          n.templateName = curName;
          n.tplId = curTpl;
          const levels = curTpl != null ? (TPL[curTpl] || []) : [];
          let lvIdx = null;
          if (n.tplLevel != null) lvIdx = n.tplLevel;
          else if (depth > FIXED.length) lvIdx = (parentLvIdx != null ? parentLvIdx + 1 : 0);
          n.tplLevel = lvIdx;
          if (n.levelName) n.levelLabel = n.levelName;
          else if (depth <= FIXED.length) n.levelLabel = FIXED[depth - 1];
          else if (lvIdx != null && levels.length > lvIdx) n.levelLabel = levels[lvIdx];
          else n.levelLabel = '自定义层级';
          walk(n.children, depth + 1, curTpl, curName, lvIdx);
        }
      })(roots, 1, null, null, null);
      const [[{ uc }]] = await pool.query('SELECT COUNT(*) AS uc FROM sys_user WHERE org_id IS NOT NULL');
      return send(res, 200, {
        tree: roots, userCount: uc, fixedLevels: FIXED,
        templates: trows.map(t => ({ id: t.id, name: t.name, levels: parseJsonArr(t.levels) }))
      });
    }
    if (pathname === '/api/admin/orgs' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return send(res, 400, { error: '组织名称必填' });
      const parentId = body.parentId ? parseInt(body.parentId, 10) : null;
      const [dup] = await pool.query('SELECT id FROM sys_org WHERE name=? AND ((parent_id=? ) OR (parent_id IS NULL AND ? IS NULL))', [name, parentId, parentId]);
      if (dup.length > 0) return send(res, 400, { error: '同级已存在同名组织: ' + name });
      const [r] = await pool.query('INSERT INTO sys_org (name, parent_id, type, sort, template_id, level_name, tpl_level) VALUES (?,?,?,?,?,?,?)',
        [name, parentId, String(body.type || 'dept'), parseInt(body.sort, 10) || 0,
         body.templateId ? (parseInt(body.templateId, 10) || null) : null,
         body.levelName ? String(body.levelName).trim() : null,
         body.tplLevel != null && body.tplLevel !== '' ? (parseInt(body.tplLevel, 10) || 0) : null]);
      return send(res, 201, { _id: String(r.insertId) });
    }
    const oIdm = pathname.match(/^\/api\/admin\/orgs\/(\d+)$/);
    if (oIdm) {
      const oid = parseInt(oIdm[1], 10);
      const [[org]] = await pool.query('SELECT * FROM sys_org WHERE id=?', [oid]);
      if (!org) return send(res, 404, { error: '组织不存在' });
      if (method === 'PUT') {
        const body = await readBody(req);
        const name = String(body.name != null ? body.name : org.name).trim();
        if (!name) return send(res, 400, { error: '组织名称必填' });
        const parentId = body.parentId != null ? (parseInt(body.parentId, 10) || null) : org.parent_id;
        if (parentId === oid) return send(res, 400, { error: '不能将组织挂在自身之下' });
        const [dup] = await pool.query('SELECT id FROM sys_org WHERE id<>? AND name=? AND ((parent_id=? ) OR (parent_id IS NULL AND ? IS NULL))', [oid, name, parentId, parentId]);
        if (dup.length > 0) return send(res, 400, { error: '同级已存在同名组织: ' + name });
        const tpl = body.templateId !== undefined ? (parseInt(body.templateId, 10) || null) : org.template_id;
        const ln = body.levelName !== undefined ? String(body.levelName).trim() : org.level_name;
        const tlv = body.tplLevel !== undefined
          ? (body.tplLevel === null || body.tplLevel === '' ? null : (parseInt(body.tplLevel, 10) || 0))
          : org.tpl_level;
        await pool.query('UPDATE sys_org SET name=?, parent_id=?, type=?, sort=?, template_id=?, level_name=?, tpl_level=? WHERE id=?',
          [name, parentId, String(body.type != null ? body.type : org.type), body.sort != null ? (parseInt(body.sort, 10) || 0) : org.sort, tpl, ln || null, tlv, oid]);
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_org WHERE parent_id=?', [oid]);
        if (c > 0) return send(res, 400, { error: '存在子组织，请先删除子组织' });
        const [[{ uc }]] = await pool.query('SELECT COUNT(*) AS c FROM sys_user WHERE org_id=?', [oid]);
        if (uc > 0) return send(res, 400, { error: '该组织下还有 ' + uc + ' 个用户，请先调整用户归属' });
        await pool.query('DELETE FROM sys_org WHERE id=?', [oid]);
        return send(res, 200, { ok: true });
      }
    }
  }

  return send(res, 404, { error: 'api not found' });
}

/* ---------- 数据表管理辅助函数 ---------- */
async function addTableLog(tableMetaId, action, detail) {
  try {
    await pool.query('INSERT INTO ops_table_log (table_meta_id, action, detail, operator) VALUES (?,?,?,?)',
      [tableMetaId, action, detail, 'admin']);
  } catch (e) { console.error('[table-log]', e.message); }
}

function genTableDDL(meta, fields) {
  const cols = [];
  const pks = [];
  const uniqs = [];
  const idxs = [];
  const fks = [];
  let hasAutoPk = true;
  fields.forEach(f => {
    let type = String(f.data_type || 'VARCHAR').toUpperCase();
    if (f.length != null && (type === 'VARCHAR' || type === 'CHAR')) type += '(' + parseInt(f.length, 10) + ')';
    else if (f.length != null && type === 'DECIMAL') type += '(' + parseInt(f.length, 10) + ',2)';
    let def = f.default_value;
    if (def != null && def !== '') {
      if (type === 'TEXT' || type === 'JSON' || type === 'DATETIME' || type === 'DATE' || type === 'TIMESTAMP') def = "'" + String(def).replace(/'/g, "''") + "'";
      else if (!/^[0-9.\-]+$/.test(String(def))) def = "'" + String(def).replace(/'/g, "''") + "'";
      def = ' DEFAULT ' + def;
    } else def = '';
    const nullStr = f.nullable ? '' : ' NOT NULL';
    const cmt = f.comment ? " COMMENT '" + String(f.comment).replace(/'/g, "''") + "'" : '';
    let col = '`' + f.field_name + '` ' + type + nullStr + def + cmt;
    if (f.is_pk) {
      pks.push('`' + f.field_name + '`');
      if (type.indexOf('INT') === 0) col += ' AUTO_INCREMENT';
      hasAutoPk = false;
    }
    if (f.is_unique) uniqs.push('`' + f.field_name + '`');
    if (f.is_index) idxs.push('`' + f.field_name + '`');
    if (f.fk_table && f.fk_field) fks.push('FOREIGN KEY (`' + f.field_name + '`) REFERENCES `' + f.fk_table + '` (`' + f.fk_field + '`)');
    cols.push(col);
  });
  if (pks.length === 0 && hasAutoPk) {
    cols.unshift('`id` INT AUTO_INCREMENT');
    pks.push('`id`');
  }
  let sql = 'CREATE TABLE IF NOT EXISTS `' + meta.table_name + '` (\n  ' + cols.join(',\n  ');
  if (pks.length > 0) sql += ',\n  PRIMARY KEY (' + pks.join(', ') + ')';
  uniqs.forEach(u => { sql += ',\n  UNIQUE KEY uk_' + u.replace(/`/g, '') + ' (' + u + ')'; });
  idxs.forEach(i => { sql += ',\n  KEY idx_' + i.replace(/`/g, '') + ' (' + i + ')'; });
  if (fks.length > 0) sql += ',\n  ' + fks.join(',\n  ');
  sql += '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  if (meta.description) sql += " COMMENT='" + String(meta.description).replace(/'/g, "''") + "'";
  return sql;
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};
function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { res.writeHead(400); res.end('Bad Request'); return; }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------- 月度实际预置数据: 从预算目标拆分(SEED_TARGET)各BU季度实际值均摊到月 ----------
 * 仅当 ops_actual 为空时写入 (演示/初始数据, 后续可编辑或导入覆盖) */
async function seedActualIfEmpty() {
  const [[c]] = await pool.query('SELECT COUNT(*) AS c FROM ops_actual');
  if (c.c > 0) return;
  const buList = ['软工', '硬工', '云', '智能汽车'];
  const metricMap = { '收入': 'actual_revenue', '贡献利润': 'actual_profit', '现金流': 'actual_cash' };
  const qKeys = ['Q1实际', 'Q2实际', 'Q3实际', 'Q4实际'];
  const byBu = {};
  SEED_TARGET.forEach(r => {
    if (!metricMap[r['指标']] || buList.indexOf(r['BU']) < 0) return;
    if (!byBu[r['BU']]) byBu[r['BU']] = {};
    byBu[r['BU']][metricMap[r['指标']]] = qKeys.map(k => Number(r[k]) || 0);
  });
  let count = 0;
  const year = new Date().getFullYear();
  for (const bu of buList) {
    const d = byBu[bu] || {};
    for (let m = 1; m <= 12; m++) {
      const qi = Math.floor((m - 1) / 3);
      const q = (arr) => (arr && arr[qi]) ? arr[qi] / 3 : 0;
      await pool.query(
        'INSERT INTO ops_actual (bu, year, month, actual_revenue, actual_profit, actual_cash, actual_expense, remark) VALUES (?,?,?,?,?,?,?,?)',
        [bu, year, m, q(d.actual_revenue), q(d.actual_profit), q(d.actual_cash), 0, '预置：目标拆分实际值·季度均摊']
      );
      count++;
    }
  }
  console.log('[init] 已写入 ' + count + ' 条月度实际数据(' + year + '年 BU×12月, 预置自目标拆分实际值)');
}

/* ---------- 预算流程预置: 从 sys_org 推导 BD→领域→BU 关系 ----------
 * 仅当 ops_budget_relation 为空时写入 */
async function seedBudgetRelationIfEmpty() {
  const [[c]] = await pool.query('SELECT COUNT(*) AS c FROM ops_budget_relation');
  if (c.c > 0) return;
  // 读取有 template_id 的节点，其子节点建立关系
  const [orgs] = await pool.query(`
    SELECT o.id, o.name, o.parent_id, o.template_id
    FROM sys_org o
    WHERE o.template_id IS NOT NULL OR o.parent_id IN (SELECT id FROM sys_org WHERE template_id IS NOT NULL)
  `);
  const bdMap = {};
  const rels = [];
  for (const o of orgs) {
    if (o.template_id) bdMap[o.id] = o.name;
  }
  for (const o of orgs) {
    if (o.parent_id && bdMap[o.parent_id]) {
      rels.push({ year: 2026, parent_org_id: o.parent_id, child_org_id: o.id, level: '领域' });
    }
  }
  if (rels.length === 0) {
    console.log('[init] 预算关系表为空，请手动配置 BD→领域→BU 关系');
    return;
  }
  for (const r of rels) {
    await pool.query(
      'INSERT INTO ops_budget_relation (year, parent_org_id, child_org_id, level) VALUES (?,?,?,?)',
      [r.year, r.parent_org_id, r.child_org_id, r.level]
    );
  }
  console.log('[init] 已写入 ' + rels.length + ' 条预算汇总关系(BD→领域)');
}

/* ---------- 数据表管理预置: 分类树 + 现有业务表注册 (仅当元数据表为空时) ---------- */
async function seedTableMetaIfEmpty() {
  const [[c]] = await pool.query('SELECT COUNT(*) AS c FROM ops_table_meta');
  if (c.c > 0) return;
  const catIds = {};
  for (const cat of SEED_TABLE_META) {
    const [r] = await pool.query(
      'INSERT INTO ops_table_meta (name, type, parent_id, table_name, description, status) VALUES (?,?,?,?,?,?)',
      [cat.name, cat.type, cat.parent_id, cat.table_name, cat.description, 'active']
    );
    catIds[cat.name] = r.insertId;
  }
  // 预算/预测/实际/目标拆分 → 经营预测; 项目合同 → 运营指标
  const catMap = { '预算管理': '经营预测', '预测管理': '经营预测', '实际回填': '经营预测', '目标拆分': '经营预测', '项目合同': '运营指标' };
  for (const t of SEED_TABLE_META_TABLES) {
    const parentId = catIds[catMap[t.name]] || null;
    await pool.query(
      'INSERT INTO ops_table_meta (name, type, parent_id, table_name, description, status) VALUES (?,?,?,?,?,?)',
      [t.name, t.type, parentId, t.table_name, t.description, 'approved']
    );
  }
  console.log('[init] 数据表管理预置完成: ' + SEED_TABLE_META.length + ' 个分类 + ' + SEED_TABLE_META_TABLES.length + ' 张业务表');
}

/* ---------- 系统管理种子数据: 管理员/角色/权限/组织 (仅空表时写入) ---------- */
async function seedSysDataIfEmpty() {
  // 角色
  const [[rcnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_role');
  let adminRoleId = null, userRoleId = null;
  if (rcnt.c === 0) {
    const [r1] = await pool.query('INSERT INTO sys_role (name, code, description) VALUES (?,?,?)', ['管理员', 'admin', '系统管理员，拥有全部权限（含后台管理）']);
    const [r2] = await pool.query('INSERT INTO sys_role (name, code, description) VALUES (?,?,?)', ['普通用户', 'user', '业务操作人员，可访问经营与运营业务模块']);
    adminRoleId = r1.insertId; userRoleId = r2.insertId;
  } else {
    const [[ar]] = await pool.query('SELECT id FROM sys_role WHERE code=?', ['admin']);
    const [[ur]] = await pool.query('SELECT id FROM sys_role WHERE code=?', ['user']);
    adminRoleId = ar ? ar.id : null; userRoleId = ur ? ur.id : null;
  }
  // 权限
  const [[pcnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_permission');
  const permIds = {};
  if (pcnt.c === 0) {
    for (const [name, code, type, parentId, sort] of SYS_PERMS) {
      const [r] = await pool.query('INSERT INTO sys_permission (name, code, type, parent_id, sort) VALUES (?,?,?,?,?)', [name, code, type, parentId, sort]);
      permIds[code] = r.insertId;
    }
  } else {
    const [rows] = await pool.query('SELECT id, code FROM sys_permission');
    rows.forEach(r => { permIds[r.code] = r.id; });
  }
  // admin 角色绑定全部权限; user 角色绑定业务权限(不含后台管理)
  if (adminRoleId) {
    const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_role_permission WHERE role_id=?', [adminRoleId]);
    if (cnt.c === 0) {
      for (const code of Object.keys(permIds)) await pool.query('INSERT IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (?,?)', [adminRoleId, permIds[code]]);
    }
  }
  if (userRoleId) {
    const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_role_permission WHERE role_id=?', [userRoleId]);
    if (cnt.c === 0) {
      for (const code of Object.keys(permIds)) {
        if (code === 'system:admin' || code === 'tablemeta:approve') continue;
        await pool.query('INSERT IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (?,?)', [userRoleId, permIds[code]]);
      }
    }
  }
  // 组织
  const [[ocnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_org');
  const orgIds = {};
  if (ocnt.c === 0) {
    for (const [name, type, parentId, sort] of SYS_ORGS) {
      const [r] = await pool.query('INSERT INTO sys_org (name, type, parent_id, sort) VALUES (?,?,?,?)', [name, type, parentId, sort]);
      orgIds[name] = r.insertId;
    }
  } else {
    const [rows] = await pool.query('SELECT id, name FROM sys_org');
    rows.forEach(r => { orgIds[r.name] = r.id; });
  }
  // 初始管理员: admin / Admin@123 (仅当无任何用户时)
  const [[ucnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_user');
  if (ucnt.c === 0) {
    const salt = genSalt();
    const orgId = orgIds['经营管理部'] || null;
    const [r] = await pool.query(
      'INSERT INTO sys_user (username, password, salt, real_name, email, phone, org_id, status) VALUES (?,?,?,?,?,?,?,1)',
      [ 'admin', hashPassword('Admin@123', salt), salt, '系统管理员', 'admin@ops.local', '', orgId ]);
    if (adminRoleId) await pool.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [r.insertId, adminRoleId]);
    console.log('[init] 系统管理预置完成: 初始管理员 admin / Admin@123 (请尽快修改密码)');
  }
}

/* ---------- 组织模型: 迁移 + 种子 (固定层配置 / 分支模板 / 存量BD挂模板) ---------- */
async function migrateOrgTable() {
  const [c1] = await pool.query("SHOW COLUMNS FROM sys_org LIKE 'template_id'");
  if (c1.length === 0) {
    await pool.query("ALTER TABLE sys_org ADD COLUMN template_id INT DEFAULT NULL COMMENT '分支模板ID(BD节点挂载)', ADD COLUMN level_name VARCHAR(50) DEFAULT NULL COMMENT '层级名覆盖'");
    console.log('[migrate] sys_org 已升级: 新增 template_id(BD挂模板)/level_name(层级名覆盖)');
  }
  const [c2] = await pool.query("SHOW COLUMNS FROM sys_org LIKE 'tpl_level'");
  if (c2.length === 0) {
    await pool.query("ALTER TABLE sys_org ADD COLUMN tpl_level INT DEFAULT NULL COMMENT '模板层级下标(0起,NULL=按深度自动推导)'");
    console.log('[migrate] sys_org 已升级: 新增 tpl_level(模板层级下标,支持跳层)');
  }
  // 动态计算并更新 depth 列
  const [hasDepth] = await pool.query("SHOW COLUMNS FROM sys_org LIKE 'depth'");
  if (hasDepth.length === 0) {
    await pool.query("ALTER TABLE sys_org ADD COLUMN depth INT DEFAULT 0 COMMENT '层级深度(1=根,递增)'");
    console.log('[migrate] sys_org 已升级: 新增 depth 列');
    // 计算 depth
    const [rows] = await pool.query('SELECT id, parent_id FROM sys_org ORDER BY id');
    const nodes = {}; rows.forEach(r => { nodes[r.id] = { id: r.id, parent_id: r.parent_id, depth: 0 }; });
    const calc = (id, d) => { if (nodes[id]) { nodes[id].depth = d; if (nodes[id].parent_id) calc(nodes[id].parent_id, d + 1); } };
    // 从根开始计算
    rows.forEach(r => { if (!r.parent_id) calc(r.id, 1); });
    // 对所有节点计算相对于根的深度
    const getDepthFromRoot = (id) => {
      let d = 0, curr = id;
      while (curr && nodes[curr]) { d++; curr = nodes[curr].parent_id; }
      return d;
    };
    for (const id in nodes) { nodes[id].depth = getDepthFromRoot(parseInt(id)); }
    for (const id in nodes) {
      await pool.query('UPDATE sys_org SET depth=? WHERE id=?', [nodes[id].depth, parseInt(id)]);
    }
    console.log('[migrate] sys_org 已计算 depth 完成');
  }
}

async function seedOrgTemplateIfEmpty() {
  // 固定层配置
  const [[cc]] = await pool.query("SELECT COUNT(*) AS c FROM sys_org_config WHERE cfg_key='fixed_levels'");
  if (cc.c === 0) {
    await pool.query('INSERT INTO sys_org_config (cfg_key, cfg_value, description) VALUES (?,?,?)',
      ['fixed_levels', JSON.stringify(ORG_FIXED_LEVELS), '全局固定层级(前三级, 所有组织统一)']);
  }
  // 分支模板种子
  const [[tc]] = await pool.query('SELECT COUNT(*) AS c FROM sys_org_template');
  if (tc.c === 0) {
    for (const [name, levels, desc] of ORG_TEMPLATE_SEEDS) {
      await pool.query('INSERT INTO sys_org_template (name, levels, description) VALUES (?,?,?)', [name, JSON.stringify(levels), desc]);
    }
    console.log('[init] 组织分支模板预置: ' + ORG_TEMPLATE_SEEDS.length + ' 套(互联网型/云业务型/职能型/硬件型)');
  }
  // 存量组织树: 三级(BD)节点若无模板则挂「职能型」兜底
  const [[fr]] = await pool.query("SELECT id FROM sys_org_template WHERE name='职能型'");
  if (fr) {
    const [rows] = await pool.query(
      'SELECT c.id FROM sys_org c JOIN sys_org p ON c.parent_id=p.id JOIN sys_org pp ON p.parent_id=pp.id WHERE c.template_id IS NULL');
    for (const r of rows) {
      await pool.query('UPDATE sys_org SET template_id=? WHERE id=?', [fr.id, r.id]);
    }
    if (rows.length > 0) console.log('[migrate] 存量三级(BD)节点已挂默认模板「职能型」: ' + rows.length + ' 个');
  }
}

/* ---------- 启动初始化: 建表 + 种子数据 ---------- */
async function init() {
  await pool.query(CREATE_TABLE_SQL);
  await pool.query(CREATE_FC_TABLE_SQL);
  await migrateForecastTable();
  const now = new Date();
  const CUR_BATCH = now.getFullYear() * 100 + (now.getMonth() + 1);   // 种子预测批次 = 当前月份
  const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM ops_records');
  if (cnt.c === 0) {
    for (const rec of SEED) {
      const db = apiToDb(rec);
      const cols = Object.keys(db);
      await pool.query(
        `INSERT INTO ops_records (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map(c => db[c])
      );
    }
    const [[after]] = await pool.query('SELECT COUNT(*) AS c FROM ops_records');
    console.log('[init] 已写入 ' + after.c + ' 条示例数据');
  }
  const [[fccnt]] = await pool.query('SELECT COUNT(*) AS c FROM ops_forecast');
  if (fccnt.c === 0) {
    for (const rec of SEED_FC) {
      const db = fcApiToDb(Object.assign({}, rec, { '预测批次': CUR_BATCH, '版本': 'V1' }));
      const cols = Object.keys(db);
      await pool.query(
        `INSERT INTO ops_forecast (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map(c => db[c])
      );
    }
    const [[fcafter]] = await pool.query('SELECT COUNT(*) AS c FROM ops_forecast');
    console.log('[init] 已写入 ' + fcafter.c + ' 条经营预测数据(' + CUR_BATCH + ' 批次 V1, 模板汇总行实际值)');
  }
  // 预算表: 旧版为每年一条(year唯一), 新版按月 (year+month唯一), 结构不匹配时自动重建
  const [bcols] = await pool.query("SHOW COLUMNS FROM ops_budget LIKE 'month'");
  if (bcols.length === 0) {
    await pool.query('DROP TABLE IF EXISTS ops_budget');
    console.log('[init] 预算表结构升级: 重建为月度预算表');
  }
  await pool.query(CREATE_BUDGET_TABLE_SQL);
  await migrateBudgetTable();
  const [[bdcnt]] = await pool.query('SELECT COUNT(*) AS c FROM ops_budget');
  if (bdcnt.c === 0) {
    for (const rec of SEED_BUDGET) {
      const db = budgetApiToDb(rec);
      const cols = Object.keys(db);
      await pool.query(
        `INSERT INTO ops_budget (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map(c => db[c])
      );
    }
    const [[bdafter]] = await pool.query('SELECT COUNT(*) AS c FROM ops_budget');
    console.log('[init] 已写入 ' + bdafter.c + ' 条月度预算数据(模板汇总行目标值)');
  }
  await pool.query(CREATE_TARGET_TABLE_SQL);
  const [[tgtcnt]] = await pool.query('SELECT COUNT(*) AS c FROM ops_target_split');
  if (tgtcnt.c === 0) {
    for (const rec of SEED_TARGET) {
      const db = targetApiToDb(rec);
      const cols = Object.keys(db);
      await pool.query(
        `INSERT INTO ops_target_split (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map(c => db[c])
      );
    }
    const [[tgtafter]] = await pool.query('SELECT COUNT(*) AS c FROM ops_target_split');
    console.log('[init] 已写入 ' + tgtafter.c + ' 条预算目标拆分数据');
  }
  await pool.query(CREATE_ACTUAL_TABLE_SQL);
  await seedActualIfEmpty();
  const [[actcnt]] = await pool.query('SELECT COUNT(*) AS c FROM ops_actual');
  // 预算流程: 编制状态 + 汇总关系 + 分解比例 + 版本管理
  await pool.query(CREATE_BUDGET_FLOW_SQL);
  await migrateBudgetFlowTable();
  await pool.query(CREATE_BUDGET_RELATION_SQL);
  await pool.query(CREATE_BUDGET_ALLOCATION_SQL);
  await pool.query(CREATE_BUDGET_VERSION_SQL);
  await migrateBudgetVersionTable();
  await seedBudgetRelationIfEmpty();
  const [[flowcnt]] = await pool.query('SELECT COUNT(*) AS c FROM ops_budget_flow');
  // 数据表管理: 元数据表 + 预置分类树
  await pool.query(CREATE_TABLE_META_SQL);
  await pool.query(CREATE_TABLE_FIELD_SQL);
  await pool.query(CREATE_TABLE_APPROVAL_SQL);
  await pool.query(CREATE_TABLE_LOG_SQL);
  await seedTableMetaIfEmpty();
  const [[tmtcnt]] = await pool.query('SELECT COUNT(*) AS c FROM ops_table_meta');
  // 系统管理: 用户/角色/权限/组织/会话 (多语句拆分执行, 连接池未开启 multipleStatements)
  for (const stmt of CREATE_SYS_TABLE_SQL.split(';')) {
    const s = String(stmt).trim();
    if (s) await pool.query(s);
  }
  await migrateOrgTable();
  await seedSysDataIfEmpty();
  await seedOrgTemplateIfEmpty();
  const [[sysucnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_user');
  const [[sysrcnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_role');
  const [[syspcnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_permission');
  const [[sysocnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_org');
  const [[sysotcnt]] = await pool.query('SELECT COUNT(*) AS c FROM sys_org_template');
  console.log('[init] MySQL 数据库就绪: ' + DB.database + ' (records=' + cnt.c + ', forecast=' + fccnt.c + ', budget=' + bdcnt.c + ', target=' + tgtcnt.c + ', actual=' + actcnt.c + ', table_meta=' + tmtcnt.c + ', sys_user=' + sysucnt.c + ', sys_role=' + sysrcnt.c + ', sys_perm=' + syspcnt.c + ', sys_org=' + sysocnt.c + ', org_tpl=' + sysotcnt.c + ')');
}

/* ---------- 启动服务 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      return res.end();
    }
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, req.method);
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405); res.end('Method Not Allowed');
  } catch (e) {
    console.error('[error]', e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[server] 运营管理平台后端已启动，端口 ' + PORT);
});
init().catch(e => {
  console.error('[init] 初始化失败:', e.message);
  process.exit(1);
});
