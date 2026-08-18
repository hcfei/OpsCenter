#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Start MariaDB, create database/user/table for ops platform."""
import sys
import json
import secrets
import string
import paramiko

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1]

DB_NAME = "ops_platform"
DB_USER = "ops_app"
DB_PASS = "Ops" + secrets.choice(string.ascii_uppercase) + secrets.token_hex(8)

# 中文前端 key -> English column names
COLUMNS = {
    "合同编号": "contract_no", "项目名称": "project_name", "客户名称": "customer",
    "合同金额": "contract_amount", "合同状态": "contract_status", "签订日期": "sign_date",
    "项目状态": "project_status", "项目负责人": "owner", "项目开始日期": "project_start",
    "项目截止日期": "project_end", "验收状态": "accept_status", "计划验收日期": "plan_accept_date",
    "实际验收日期": "actual_accept_date", "回款金额": "payment_amount", "回款状态": "payment_status",
    "计划回款日期": "plan_payment_date", "备注": "remark",
}

CREATE_TABLE_SQL = """
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

def run(cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out, err

# 1. Start & enable MariaDB
code, out, err = run("systemctl enable --now mariadb 2>&1; systemctl is-active mariadb")
print("1. MariaDB active:", out or err)
assert "active" in (out + err), "MariaDB failed to start"

# 2. Wait until socket ready
code, out, err = run("for i in $(seq 1 20); do mysqladmin ping 2>/dev/null && break; sleep 1; done; mysqladmin ping 2>/dev/null")
print("2. MariaDB ping:", out or err)

# 3. Create database (root uses unix_socket auth by default on fresh install)
sql_setup = (
    f"CREATE DATABASE IF NOT EXISTS {DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; "
    f"CREATE USER IF NOT EXISTS '{DB_USER}'@'localhost' IDENTIFIED BY '{DB_PASS}'; "
    f"GRANT ALL PRIVILEGES ON {DB_NAME}.* TO '{DB_USER}'@'localhost'; FLUSH PRIVILEGES;"
)
code, out, err = run(f"mysql -e \"{sql_setup}\" 2>&1")
print("3. Create DB/user:", out or err or "OK")
assert code == 0, "DB/user creation failed"

# 4. Create table
sql_escaped = CREATE_TABLE_SQL.replace("'", "'\\''").replace("\n", " ")
code, out, err = run(f"mysql {DB_NAME} -e \"{sql_escaped}\" 2>&1")
print("4. Create table:", out or err or "OK")
assert code == 0, "Table creation failed"

# 5. Verify with app user (password auth)
code, out, err = run(
    f"mysql -u {DB_USER} -p'{DB_PASS}' -h 127.0.0.1 {DB_NAME} -e 'SHOW TABLES; DESCRIBE ops_records;' 2>&1"
)
print("5. Verify with app user:")
print(out or err)
assert code == 0 and "ops_records" in out, "App user cannot access table"

# 6. Write db_config.json to /opt/ops-platform
config = {
    "host": "127.0.0.1",
    "port": 3306,
    "user": DB_USER,
    "password": DB_PASS,
    "database": DB_NAME,
}
cfg_json = json.dumps(config)
code, out, err = run(
    f"mkdir -p /opt/ops-platform && printf '%s' '{cfg_json}' > /opt/ops-platform/db_config.json && chmod 600 /opt/ops-platform/db_config.json && echo SAVED"
)
print("6. db_config.json:", out or err)

client.close()
print("SETUP_DB_DONE")
print("DB_PASS=" + DB_PASS)
