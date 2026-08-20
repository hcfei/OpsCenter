/* 数据迁移模块
 * 包含表结构创建和种子数据
 */

const { query, getPool } = require('./pool');

/* 表结构定义 */
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  bu VARCHAR(20) NOT NULL DEFAULT '汇总' COMMENT 'BU维度',
  revenue DECIMAL(14,2) DEFAULT 0,
  cost DECIMAL(14,2) DEFAULT 0,
  gross_profit DECIMAL(14,2) DEFAULT 0,
  gross_margin DECIMAL(5,2) DEFAULT 0,
  headcount_cost DECIMAL(14,2) DEFAULT 0,
  outsource_cost DECIMAL(14,2) DEFAULT 0,
  travel_cost DECIMAL(14,2) DEFAULT 0,
  project_count INT DEFAULT 0,
  maintain_project_count INT DEFAULT 0,
  new_project_count INT DEFAULT 0,
  closed_project_count INT DEFAULT 0,
  sign_date DATE,
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_year_month_bu (year, month, bu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_FC_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_forecast (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fc_month INT NULL COMMENT '预测批次 YYYYMM',
  version VARCHAR(10) NULL COMMENT '版本',
  bu VARCHAR(20) NOT NULL DEFAULT '汇总' COMMENT 'BU维度',
  org_id INT NULL COMMENT '组织维度',
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  forecast_revenue DECIMAL(14,2) DEFAULT 0,
  contribution_profit DECIMAL(14,2) DEFAULT 0,
  cash_flow DECIMAL(14,2) DEFAULT 0,
  expense DECIMAL(14,2) DEFAULT 0,
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_fc_ver_org_ym (fc_month, version, org_id, bu, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_BUDGET_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_budget (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  bu VARCHAR(20) NOT NULL DEFAULT '汇总' COMMENT 'BU维度',
  org_id INT NULL COMMENT '组织维度',
  budget_revenue DECIMAL(14,2) DEFAULT 0,
  budget_profit DECIMAL(14,2) DEFAULT 0,
  budget_cash DECIMAL(14,2) DEFAULT 0,
  budget_expense DECIMAL(14,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_year_month_org_bu (year, month, org_id, bu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CREATE_ACTUAL_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ops_actual (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  bu VARCHAR(20) NOT NULL DEFAULT '汇总' COMMENT 'BU维度（汇总不落库）',
  org_id INT NULL COMMENT '组织维度',
  actual_revenue DECIMAL(14,2) DEFAULT 0,
  actual_profit DECIMAL(14,2) DEFAULT 0,
  actual_cash DECIMAL(14,2) DEFAULT 0,
  actual_expense DECIMAL(14,2) DEFAULT 0,
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_actual_org_bu_ym (org_id, bu, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 执行迁移 */
async function runMigrations() {
  console.log('[migrate] 开始数据迁移...');

  // 创建表
  await query(CREATE_TABLE_SQL);
  console.log('[migrate] ops_records 表已创建');

  await query(CREATE_FC_TABLE_SQL);
  console.log('[migrate] ops_forecast 表已创建');

  await query(CREATE_BUDGET_TABLE_SQL);
  console.log('[migrate] ops_budget 表已创建');

  await query(CREATE_ACTUAL_TABLE_SQL);
  console.log('[migrate] ops_actual 表已创建');

  // TODO: 添加更多表结构迁移
  // TODO: 添加数据迁移逻辑

  console.log('[migrate] 数据迁移完成');
}

module.exports = {
  CREATE_TABLE_SQL,
  CREATE_FC_TABLE_SQL,
  CREATE_BUDGET_TABLE_SQL,
  CREATE_ACTUAL_TABLE_SQL,
  runMigrations
};
