#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Finish MySQL init: set root password, create DB/user/table, verify."""
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
ROOT_PASS = "R" + secrets.choice(string.ascii_uppercase) + secrets.token_hex(10) + "!"

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

def run(cmd, timeout=120):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out, err

# 1. Set root password + create DB/user
print("1. Setting root password, creating DB/user...")
SQL = (
    f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{ROOT_PASS}'; "
    f"CREATE DATABASE IF NOT EXISTS {DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; "
    f"CREATE USER IF NOT EXISTS '{DB_USER}'@'localhost' IDENTIFIED BY '{DB_PASS}'; "
    f"GRANT ALL PRIVILEGES ON {DB_NAME}.* TO '{DB_USER}'@'localhost'; FLUSH PRIVILEGES;"
)
code, out, err = run(f"mysql -uroot -e \"{SQL}\" 2>&1")
print("   ", out or err or "OK")
assert code == 0, "MySQL init SQL failed"

# 2. Verify root password works
code, out, err = run(f"mysql -uroot -p'{ROOT_PASS}' -e 'SELECT 1' 2>&1 | tail -2")
print("2. root password login:", out or err or "OK")
assert code == 0, "root password login failed"

# 3. Create table
sql_escaped = CREATE_TABLE_SQL.replace("'", "'\\''").replace("\n", " ")
code, out, err = run(f"mysql -uroot -p'{ROOT_PASS}' {DB_NAME} -e \"{sql_escaped}\" 2>&1")
print("3. Create table:", out or err or "OK")
assert code == 0, "Table creation failed"

# 4. Verify with app user over TCP
code, out, err = run(
    f"mysql -u {DB_USER} -p'{DB_PASS}' -h 127.0.0.1 {DB_NAME} -e 'SHOW TABLES; DESCRIBE ops_records;' 2>&1"
)
print("4. Verify with app user:")
print(out or err)
assert code == 0 and "ops_records" in out, "App user cannot access table"

# 5. Write db_config.json
config = {"host": "127.0.0.1", "port": 3306, "user": DB_USER, "password": DB_PASS, "database": DB_NAME}
cfg_json = json.dumps(config)
code, out, err = run(
    f"mkdir -p /opt/ops-platform && printf '%s' '{cfg_json}' > /opt/ops-platform/db_config.json && chmod 600 /opt/ops-platform/db_config.json && echo SAVED"
)
print("5. db_config.json:", out or err)

client.close()
print("MYSQL_FINAL_DONE")
print("DB_PASS=" + DB_PASS)
print("ROOT_PASS=" + ROOT_PASS)
