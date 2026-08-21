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

/* 费用类型表 */
const CREATE_EXPENSE_TYPE_SQL = `
CREATE TABLE IF NOT EXISTS ops_expense_type (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL COMMENT '类型名称',
  code VARCHAR(20) NOT NULL COMMENT '类型编码',
  parent_id INT NULL COMMENT '父类型ID',
  sort INT DEFAULT 0,
  status TINYINT DEFAULT 1 COMMENT '状态：1启用/0禁用',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 费用预算表 */
const CREATE_EXPENSE_BUDGET_SQL = `
CREATE TABLE IF NOT EXISTS ops_expense_budget (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL COMMENT '组织ID',
  expense_type_id INT NOT NULL COMMENT '费用类型ID',
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  budget_amount DECIMAL(14,2) DEFAULT 0 COMMENT '预算金额',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_expense_budget_ym (org_id, expense_type_id, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 费用实际表 */
const CREATE_EXPENSE_ACTUAL_SQL = `
CREATE TABLE IF NOT EXISTS ops_expense_actual (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL COMMENT '组织ID',
  expense_type_id INT NOT NULL COMMENT '费用类型ID',
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  actual_amount DECIMAL(14,2) DEFAULT 0 COMMENT '实际金额',
  remark VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_expense_actual_ym (org_id, expense_type_id, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 费用预测表 */
const CREATE_EXPENSE_FORECAST_SQL = `
CREATE TABLE IF NOT EXISTS ops_expense_forecast (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL COMMENT '组织ID',
  expense_type_id INT NOT NULL COMMENT '费用类型ID',
  year INT NOT NULL,
  month INT NOT NULL DEFAULT 1,
  forecast_amount DECIMAL(14,2) DEFAULT 0 COMMENT '预测金额',
  fc_month INT NULL COMMENT '预测批次 YYYYMM',
  version VARCHAR(10) NULL DEFAULT 'V1' COMMENT '版本号',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_expense_fc_ym (org_id, expense_type_id, year, month, fc_month, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/* 种子数据：费用类型 */
const SEED_EXPENSE_TYPES = [
  { name: '人力成本', code: 'HR', parent_id: null, sort: 1 },
  { name: '研发费用', code: 'RD', parent_id: null, sort: 2 },
  { name: '销售费用', code: 'Sales', parent_id: null, sort: 3 },
  { name: '管理费用', code: 'Admin', parent_id: null, sort: 4 },
  { name: '运营费用', code: 'Ops', parent_id: null, sort: 5 }
];

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

  // 费用管理表
  await query(CREATE_EXPENSE_TYPE_SQL);
  console.log('[migrate] ops_expense_type 表已创建');

  await query(CREATE_EXPENSE_BUDGET_SQL);
  console.log('[migrate] ops_expense_budget 表已创建');

  await query(CREATE_EXPENSE_ACTUAL_SQL);
  console.log('[migrate] ops_expense_actual 表已创建');

  await query(CREATE_EXPENSE_FORECAST_SQL);
  console.log('[migrate] ops_expense_forecast 表已创建');

  // 种子数据
  await seedExpenseTypes();

  console.log('[migrate] 数据迁移完成');
}

/* 种子数据：费用类型 */
async function seedExpenseTypes() {
  try {
    const [[cnt]] = await query('SELECT COUNT(*) as c FROM ops_expense_type');
    if (cnt.c > 0) {
      console.log('[migrate] 费用类型已存在，跳过种子');
      return;
    }
    for (const t of SEED_EXPENSE_TYPES) {
      await query(
        'INSERT INTO ops_expense_type (name, code, parent_id, sort, status) VALUES (?, ?, ?, ?, 1)',
        [t.name, t.code, t.parent_id, t.sort]
      );
    }
    console.log('[migrate] 费用类型种子数据已写入: ' + SEED_EXPENSE_TYPES.length + ' 条');
  } catch (e) {
    console.error('[migrate] 费用类型种子写入失败:', e.message);
  }
}

module.exports = {
  CREATE_TABLE_SQL,
  CREATE_FC_TABLE_SQL,
  CREATE_BUDGET_TABLE_SQL,
  CREATE_ACTUAL_TABLE_SQL,
  CREATE_EXPENSE_TYPE_SQL,
  CREATE_EXPENSE_BUDGET_SQL,
  CREATE_EXPENSE_ACTUAL_SQL,
  CREATE_EXPENSE_FORECAST_SQL,
  runMigrations
};
