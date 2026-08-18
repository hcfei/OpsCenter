# 运营管理平台 - MySQL 数据库版

## 简介

运营管理平台（运营看板 + 经营看板 + 合同/项目/验收/回款管理），数据全部存储在 MySQL 数据库中，通过 Node.js 后端 API 读写。支持多设备同时访问、数据统一存储。

## 架构

```
浏览器 (运营管理平台.html)
   │  REST API (fetch /api/records, /api/forecast)
   ▼
Node.js 后端 (app.js, 端口 80)
   │  mysql2 连接池
   ▼
MySQL 8 (ops_platform.ops_records / ops_forecast / ops_budget / ops_target_split)
```

## 文件清单

| 文件 | 说明 |
|------|------|
| `app.js` | Node.js 后端：REST API + 静态页面托管 |
| `package.json` | 依赖声明（mysql2） |
| `db_config.json` | 数据库连接配置（服务器生成，权限 600，**勿提交**） |
| `运营管理平台.html` | 前端页面（index.html 为同副本） |
| `README.md` | 本说明文件 |

## 数据库

- 库：`ops_platform`（utf8mb4）
- 表：`ops_records`（17 个业务字段 + id/created_at/updated_at）
- 表：`ops_forecast`（经营预测：year/month 唯一，forecast_revenue/contribution_profit/cash_flow/expense/remark）
- 表：`ops_budget`（月度预算：year+month 唯一，budget_revenue/budget_profit/budget_cash/budget_expense，季度/半年度/全年自动聚合，用于达成率计算）
- 表：`ops_target_split`（预算目标拆分：metric+bu 唯一，q1-q4/h1/h2/ytd 的实际值(7月)与2026年目标-V1 共 14 个 DECIMAL(18,6) 数值列，数据来源《预测结果模板.xlsx》预算目标拆分 Sheet，3 指标 × 5 BU = 15 条）
- 连接用户：`ops_app`（仅 localhost 权限，密码在服务器 db_config.json）

## API 说明

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/records` | 获取全部记录（按签订日期倒序） |
| POST | `/api/records` | 新增记录 |
| PUT | `/api/records/:id` | 更新记录 |
| DELETE | `/api/records/:id` | 删除记录 |
| POST | `/api/records/batch` | 批量导入（覆盖式，事务） |
| GET | `/api/forecast?year=2026` | 获取指定年份经营预测（不带 year 返回全部） |
| POST | `/api/forecast` | 新增/更新月度预测（同一年月自动覆盖更新） |
| PUT | `/api/forecast/:id` | 更新月度预测（年度/月份不可改） |
| DELETE | `/api/forecast/:id` | 删除月度预测 |
| GET | `/api/budget?year=2026` | 获取指定年份月度预算（12 条/年，不带 year 返回全部） |
| POST/PUT | `/api/budget` | 新增/更新单月预算（year+month 唯一，自动覆盖） |
| POST | `/api/budget/batch` | 批量保存月度预算（按年份整年覆盖，事务；用于预算弹窗全量保存） |
| GET | `/api/target-split` | 获取预算目标拆分全部记录（指标 → BU 固定排序） |
| POST/PUT | `/api/target-split` | 新增/更新目标拆分记录（metric+bu 唯一，自动覆盖） |
| POST | `/api/target-split/batch` | 覆盖式批量写入（事务，清空后全量插入） |
| PUT | `/api/target-split/:id` | 更新记录数值（指标/BU 维度不可改） |
| DELETE | `/api/target-split/:id` | 删除记录 |

前端字段为中文 key（合同编号、项目名称...；经营看板：年度、月份、预测收入、贡献利润、现金流、费用、备注），后端自动映射为英文列名。

## 部署

### 服务器部署（systemd 服务）

```bash
# 1. 安装 MySQL 8 + 启动（首次需处理 dnf exclude，见 install_mysql2.py）
dnf install -y mysql-server
systemctl enable --now mysqld

# 2. 初始化数据库（首次）
mysql -uroot -p
  > CREATE DATABASE ops_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  > CREATE USER 'ops_app'@'localhost' IDENTIFIED BY '你的密码';
  > GRANT ALL PRIVILEGES ON ops_platform.* TO 'ops_app'@'localhost';
  > FLUSH PRIVILEGES;

# 3. 安装依赖并启动后端
cd /opt/ops-platform
npm install --omit=dev
systemctl daemon-reload && systemctl restart ops-platform
```

### systemd 服务（ops-platform.service）

```ini
[Unit]
Description=Ops Platform - Node.js + MySQL
After=network.target mysqld.service
Wants=mysqld.service

[Service]
Type=simple
WorkingDirectory=/opt/ops-platform
ExecStart=/usr/bin/node /opt/ops-platform/app.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

首次启动自动建表；表为空时自动写入 5 条示例数据。

## 数据说明

- **存储位置**：MySQL 数据库（多端共享，实时同步）
- **数据备份**：右上角导出 JSON（含全部记录）
- **数据恢复**：右上角导入 JSON（覆盖式，走 batch API 事务）
- **表单草稿**：仍用浏览器 localStorage 缓存（仅草稿，非业务数据）

## 功能模块

| 模块 | 功能 |
|------|------|
| 经营看板 | 年度预测达成总览（年度收入/贡献利润/贡献利润率/现金流 预测达成值与达成率，相对全年预算）、分时段标签「各月 / 各季度 / 半年度」展示收入与贡献利润达成（达成率折线图含 100% 目标线 + 明细表：预测/预算/达成率/贡献利润率）、月度预算设置弹窗（12 行×4 指标 + 快速分摊模式）。**默认首页，导航排第一位** |
| 运营看板 | KPI 概览、今日待处理、合同状态饼图、回款进度柱状图 |
| 预算目标拆分 | 收入/贡献利润/现金流 × 软工/硬工/云/智能汽车/汇总（3×5=15 条）：实际值(7月) vs 2026年目标-V1 各 7 个周期列（Q1-Q4/H1/H2/YTD）+ 偏差 + 达成率（含 H1+Q3 组合列），达成率 ≥95% 绿 / 70-95% 黄 / <70% 红 |
| 合同管理 | 合同编号、项目、客户、金额、状态、签订日期 |
| 项目管理 | 项目状态、负责人、起止日期 |
| 验收管理 | 验收状态、计划/实际验收日期，逾期自动标红 |
| 回款管理 | 合同/已回/待回款自动计算，回款状态跟踪 |

## 经营看板说明

- 数据按月录入（`ops_forecast` 表，year+month 唯一），季度/半年度自动聚合
- **预算按月录入**（`ops_budget` 表，year+month 唯一）：页面「预算」按钮打开月度预算弹窗，12 个月 × 4 指标（收入/贡献利润/现金流/费用）逐行填写，或填入全年总额后按「平均分摊 / 逐月递增 / 按比例」快速拆分；季度/半年度预算由月度自动聚合
- **页面结构**（2026-08-18 改版）：
  - 顶部「年度预测达成总览」：年度收入 / 贡献利润 / 贡献利润率 / 现金流 4 张卡片（全年口径），显示预测达成值 + 达成率 + 预算目标；贡献利润率卡同时给出目标利润率与预测口径利润率
  - 下方「各月 / 各季度 / 半年度」标签：达成率折线图（收入达成率 + 贡献利润达成率，含 100% 目标线）+ 达成明细表（期间 / 预测收入 / 预算收入 / 收入达成率 / 预测贡献利润 / 预算贡献利润 / 利润达成率 / 贡献利润率）
- **达成率体系**：达成率 = 该周期预测值 ÷ 该周期预算（月度=当月预算、季度=当季预算合计、半年度=该半年预算合计）；颜色 ≥95% 绿 / 70-95% 黄 / <70% 红
- 贡献利润率 = 贡献利润 ÷ 收入（前端派生计算，不入库）
- 月度维度缺月行显示「+」可直接补录；聚合行只读

## 预算目标拆分说明

- 数据来源：《预测结果模板.xlsx》「预算目标拆分」Sheet（用户提供，`standalone/extract_template_data.py` 提取，`forecast_template_data.json` 为提取结果）
- 维度：3 指标（收入 / 贡献利润 / 现金流）× 5 BU（软工 / 硬工 / 云 / 智能汽车 / 汇总）= 15 条，汇总行为四个 BU 之和（误差 ≤1e-6）
- 数值列：实际值（7月）与 2026年目标-V1 各 7 列（Q1/Q2/Q3/Q4/H1/H2/YTD），DECIMAL(18,6) 保持模板 6 位小数精度；单位：万元
- **偏差、达成率不入库，前端实时计算**：偏差 = 实际 − 目标（正=超额 绿 / 负=缺口 红）；达成率 = 实际 ÷ 目标，≥95% 绿 / 70-95% 黄 / <70% 红
- 达成率表头含 **H1+Q3 组合列**：= (H1实际+Q3实际) ÷ (H1目标+Q3目标)，用于年中评审口径
- 编辑弹窗：新增/编辑/删除；编辑时指标与 BU 维度锁定（维度不可改，需删除重建）
- 模板提取脚本：`read_forecast_template.py`（结构解析）、`extract_template_data.py`（数据提取，含合并单元格向下填充修复）

## 技术特性

- 前端零外部依赖（CSS/JS/SVG 全内联）
- 后端仅依赖 mysql2（Node 内置 http 模块）
- SQL 全部参数化查询，字段白名单过滤，防注入
- 响应式双端适配（PC 顶部导航 + 手机底部 Tab）
- 内联 SVG 图表（饼图、柱状图、折线图）

## 自定义

- 下拉选项：编辑 HTML 中 `SCHEMA_OPTIONS`
- 示例数据：编辑 app.js 中 `SEED` / `SEED_FC` 数组（仅表为空时写入）
- 主题色：编辑 HTML 中 `:root` CSS 变量
- 数据库密码：`/opt/ops-platform/db_config.json`（chmod 600）
