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

/* ---------- 经营预测字段映射 (前端中文 key <-> 数据库英文列) ---------- */
const FC_FIELD_PAIRS = [
  ['年度', 'year'], ['月份', 'month'], ['预测收入', 'forecast_revenue'],
  ['贡献利润', 'contribution_profit'], ['现金流', 'cash_flow'], ['费用', 'expense'], ['备注', 'remark']
];
const FC_CN2COL = {};
const FC_COL2CN = {};
FC_FIELD_PAIRS.forEach(p => { FC_CN2COL[p[0]] = p[1]; FC_COL2CN[p[1]] = p[0]; });
const FC_MONEY_COLS = new Set(['forecast_revenue', 'contribution_profit', 'cash_flow', 'expense']);

/* ---------- 月度预算字段映射 (前端中文 key <-> 数据库英文列) ---------- */
const BUDGET_FIELD_PAIRS = [
  ['年度', 'year'], ['月份', 'month'], ['预算收入', 'budget_revenue'], ['预算贡献利润', 'budget_profit'],
  ['预算现金流', 'budget_cash'], ['预算费用', 'budget_expense']
];
const BUDGET_CN2COL = {};
const BUDGET_COL2CN = {};
BUDGET_FIELD_PAIRS.forEach(p => { BUDGET_CN2COL[p[0]] = p[1]; BUDGET_COL2CN[p[1]] = p[0]; });
const BUDGET_MONEY_COLS = new Set(['budget_revenue', 'budget_profit', 'budget_cash', 'budget_expense']);

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
 * 每次预测覆盖全年 (year+month 12 条), 同一批次可多个版本; (fc_month, version, year, month) 唯一 */
const CREATE_FC_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_forecast (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fc_month INT NULL COMMENT '预测批次月份 YYYYMM',
  version VARCHAR(10) NULL COMMENT '批次内版本 V1/V2/...',
  year INT NOT NULL,
  month INT NOT NULL,
  forecast_revenue DECIMAL(14,2) DEFAULT 0,
  contribution_profit DECIMAL(14,2) DEFAULT 0,
  cash_flow DECIMAL(14,2) DEFAULT 0,
  expense DECIMAL(14,2) DEFAULT 0,
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_fc_ver_ym (fc_month, version, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 经营预测表结构迁移 (旧版: year+month 唯一 -> 新版: 批次+版本+年月唯一):
 * 1. 补 fc_month / version 列, 存量数据归入"当前月份批次 V1"
 * 2. 唯一键从 uk_year_month 升级为 uk_fc_ver_ym */
async function migrateForecastTable() {
  const [cols] = await pool.query("SHOW COLUMNS FROM ops_forecast LIKE 'fc_month'");
  if (cols.length === 0) {
    await pool.query('ALTER TABLE ops_forecast ADD COLUMN fc_month INT NULL AFTER id, ADD COLUMN version VARCHAR(10) NULL AFTER fc_month');
    const now = new Date();
    const ym = now.getFullYear() * 100 + (now.getMonth() + 1);
    await pool.query("UPDATE ops_forecast SET fc_month=?, version='V1' WHERE fc_month IS NULL", [ym]);
    console.log('[migrate] ops_forecast 已升级: 新增 fc_month(预测批次)/version(版本), 存量数据归入 ' + ym + ' 批次 V1');
  }
  const [idx] = await pool.query("SHOW INDEX FROM ops_forecast WHERE Key_name='uk_fc_ver_ym'");
  if (idx.length === 0) {
    try { await pool.query('ALTER TABLE ops_forecast DROP INDEX uk_year_month'); } catch (e) { /* 旧索引不存在则跳过 */ }
    await pool.query('ALTER TABLE ops_forecast ADD UNIQUE KEY uk_fc_ver_ym (fc_month, version, year, month)');
    console.log('[migrate] ops_forecast 唯一键升级: (fc_month, version, year, month)');
  }
}

/* 默认预测批次: 取最新批次, 无数据时取当前月份 */
async function defaultFcBatch() {
  const [rows] = await pool.query('SELECT fc_month FROM ops_forecast WHERE fc_month IS NOT NULL ORDER BY fc_month DESC LIMIT 1');
  if (rows.length > 0) return rows[0].fc_month;
  const now = new Date();
  return now.getFullYear() * 100 + (now.getMonth() + 1);
}

/* 月度预算表: 每年 12 条 (year+month 唯一), 季度/半年度/全年由月度聚合 */
const CREATE_BUDGET_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_budget (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  budget_revenue DECIMAL(14,2) DEFAULT 0,
  budget_profit DECIMAL(14,2) DEFAULT 0,
  budget_cash DECIMAL(14,2) DEFAULT 0,
  budget_expense DECIMAL(14,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_year_month (year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

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
  return api;
}
function fcApiToDb(record) {
  const db = {};
  Object.keys(FC_CN2COL).forEach(cn => {
    if (!(cn in record)) return;
    const col = FC_CN2COL[cn], v = record[cn];
    if (FC_MONEY_COLS.has(col)) db[col] = parseFloat(v) || 0;
    else if (col === 'year' || col === 'month') db[col] = parseInt(v, 10) || 0;
    else db[col] = (v === '' || v === null || v === undefined) ? null : String(v);
  });
  if ('预测批次' in record) db.fc_month = parseInt(record['预测批次'], 10) || 0;
  if ('版本' in record) db.version = String(record['版本'] || 'V1');
  return db;
}
function budgetRowToApi(row) {
  const api = { _id: String(row.id), 年度: row.year, 月份: row.month };
  BUDGET_FIELD_PAIRS.forEach(p => {
    const cn = p[0], col = p[1];
    if (cn === '年度' || cn === '月份') return;
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
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

/* ---------- API 路由 ---------- */
async function handleApi(req, res, pathname, method) {
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
    // 整批导入/覆盖: {fcMonth, version, year, records:[{年度,月份,预测收入,...}...]}
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    const fcMonth = parseInt((body && body.fcMonth) || (list[0] && list[0]['预测批次']) || 0, 10) || await defaultFcBatch();
    const version = String((body && body.version) || (list[0] && list[0]['版本']) || 'V1');
    const year = parseInt((body && body.year) || (list[0] && list[0]['年度']) || 0, 10);
    if (!year) return send(res, 400, { error: 'year required' });
    if (list.length === 0) return send(res, 400, { error: 'expected non-empty records' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM ops_forecast WHERE fc_month=? AND version=? AND year=?', [fcMonth, version, year]);
      let count = 0;
      for (const rec of list) {
        const db = fcApiToDb(Object.assign({}, rec, { '预测批次': fcMonth, '版本': version, '年度': year }));
        const cols = Object.keys(db);
        if (cols.length === 0 || !db.year || !db.month) continue;
        await conn.query(
          `INSERT INTO ops_forecast (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map(c => db[c])
        );
        count++;
      }
      await conn.commit();
      return send(res, 200, { count, fcMonth, version, year });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  if (pathname === '/api/forecast/clone' && method === 'POST') {
    // 复制版本: {fromFcMonth, fromVersion, toFcMonth, toVersion} (同批次新版本 / 滚动到下月新批次)
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
          'INSERT INTO ops_forecast (fc_month, version, year, month, forecast_revenue, contribution_profit, cash_flow, expense, remark) VALUES (?,?,?,?,?,?,?,?,?)',
          [toFcMonth, toVersion, r.year, r.month, r.forecast_revenue, r.contribution_profit, r.cash_flow, r.expense, r.remark]
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
      let sql = 'SELECT * FROM ops_forecast WHERE 1=1';
      const params = [];
      if (fcMonth) { sql += ' AND fc_month=?'; params.push(fcMonth); }
      if (version) { sql += ' AND version=?'; params.push(String(version)); }
      if (year) { sql += ' AND year=?'; params.push(parseInt(year, 10)); }
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
      // 唯一键 (fc_month, version, year, month): 已存在则按同一键更新
      const updCols = cols.filter(c => c !== 'year' && c !== 'month' && c !== 'fc_month' && c !== 'version');
      let sql;
      if (updCols.length > 0) {
        sql = `INSERT INTO ops_forecast (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
               ON DUPLICATE KEY UPDATE ${updCols.map(c => c + '=VALUES(' + c + ')').join(',')}`;
      } else {
        sql = `INSERT IGNORE INTO ops_forecast (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      }
      const [r] = await pool.query(sql, cols.map(c => db[c]));
      const id = r.insertId || (await pool.query('SELECT id FROM ops_forecast WHERE fc_month=? AND version=? AND year=? AND month=?', [db.fc_month, db.version, db.year, db.month]))[0][0].id;
      return send(res, 201, { _id: String(id) });
    }
  }
  if (pathname === '/api/budget/batch' && method === 'POST') {
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : (body && body.records) || [];
    if (list.length === 0) return send(res, 400, { error: 'expected non-empty array' });
    const year = parseInt(list[0]['年度'], 10) || 0;
    if (!year) return send(res, 400, { error: 'year required' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM ops_budget WHERE year=?', [year]);
      let count = 0;
      for (const rec of list) {
        const db = budgetApiToDb(rec);
        const cols = Object.keys(db);
        if (cols.length === 0 || !db.year || !db.month) continue;
        await conn.query(
          `INSERT INTO ops_budget (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map(c => db[c])
        );
        count++;
      }
      await conn.commit();
      return send(res, 200, { count, year });
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
      let sql = 'SELECT * FROM ops_budget ORDER BY year ASC, month ASC';
      const params = [];
      if (year) { sql = 'SELECT * FROM ops_budget WHERE year=? ORDER BY month ASC'; params.push(parseInt(year, 10)); }
      const [rows] = await pool.query(sql, params);
      return send(res, 200, rows.map(budgetRowToApi));
    }
    if (method === 'POST' || method === 'PUT') {
      const body = await readBody(req);
      const db = budgetApiToDb(body);
      if (!db.year || !db.month) return send(res, 400, { error: 'year and month required' });
      const cols = Object.keys(db);
      const updCols = cols.filter(c => c !== 'year' && c !== 'month');
      let sql;
      if (updCols.length > 0) {
        sql = `INSERT INTO ops_budget (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
               ON DUPLICATE KEY UPDATE ${updCols.map(c => c + '=VALUES(' + c + ')').join(',')}`;
      } else {
        sql = `INSERT IGNORE INTO ops_budget (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      }
      const [r] = await pool.query(sql, cols.map(c => db[c]));
      const id = r.insertId || (await pool.query('SELECT id FROM ops_budget WHERE year=? AND month=?', [db.year, db.month]))[0][0].id;
      return send(res, 200, { _id: String(id) });
    }
  }
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
  return send(res, 404, { error: 'api not found' });
}

/* ---------- 静态文件 ---------- */
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
  console.log('[init] MySQL 数据库就绪: ' + DB.database + ' (records=' + cnt.c + ', forecast=' + fccnt.c + ', budget=' + bdcnt.c + ', target=' + tgtcnt.c + ')');
}

/* ---------- 启动服务 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
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
