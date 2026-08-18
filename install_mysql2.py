#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Remove mysql from dnf exclude, install MySQL 8, init DB/user/table."""
import sys
import json
import re
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

def run(cmd, timeout=300):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out, err

# 0. Backup & patch dnf.conf: remove "mysql" from exclude line
print("0. Patching dnf.conf exclude...")
code, out, err = run("cp -n /etc/dnf/dnf.conf /etc/dnf/dnf.conf.bak && sed -i 's/^exclude=httpd nginx php mysql mairadb/exclude=httpd nginx php mairadb/' /etc/dnf/dnf.conf && grep '^exclude' /etc/dnf/dnf.conf")
print("   now:", out or err)

# 1. Install MySQL server
print("1. Installing mysql-server...")
code, out, err = run("dnf install -y mysql-server --allowerasing --nobest 2>&1 | tail -12")
print(out or err)
code, out, err = run("rpm -q mysql-server")
print("   installed:", out)
assert "mysql-server" in out, "mysql-server install failed"

# 2. Start & enable mysqld
print("2. Starting mysqld...")
code, out, err = run("systemctl enable --now mysqld 2>&1; sleep 3; systemctl is-active mysqld")
print("   active:", out or err)
assert "active" in (out + err), "mysqld failed to start"

# 3. Wait for socket + read temp root password
print("3. Reading temporary root password...")
code, out, err = run("""
for i in $(seq 1 30); do
  mysqladmin --connect-timeout=2 ping >/dev/null 2>&1 && break
  sleep 1
done
grep -E 'temporary password' /var/log/mysqld.log 2>/dev/null | tail -1
""")
print(out or err)
m = re.search(r"temporary password is generated for root@localhost: (\S+)", out + err)
assert m, "Could not find temporary root password in mysqld.log"
TEMP_PASS = m.group(1)

# 4. Change root password & create DB/user
print("4. Initializing root password, creating DB/user...")
SQL = (
    f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{ROOT_PASS}'; "
    f"CREATE DATABASE IF NOT EXISTS {DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; "
    f"CREATE USER IF NOT EXISTS '{DB_USER}'@'localhost' IDENTIFIED BY '{DB_PASS}'; "
    f"GRANT ALL PRIVILEGES ON {DB_NAME}.* TO '{DB_USER}'@'localhost'; FLUSH PRIVILEGES;"
)
code, out, err = run(f"mysql -uroot -p'{TEMP_PASS}' --connect-expired-password -e \"{SQL}\" 2>&1")
print("   ", out or err or "OK")
assert code == 0, "MySQL init SQL failed"

# 5. Create table via root
sql_escaped = CREATE_TABLE_SQL.replace("'", "'\\''").replace("\n", " ")
code, out, err = run(f"mysql -uroot -p'{ROOT_PASS}' {DB_NAME} -e \"{sql_escaped}\" 2>&1")
print("5. Create table:", out or err or "OK")
assert code == 0, "Table creation failed"

# 6. Verify with app user over TCP
code, out, err = run(
    f"mysql -u {DB_USER} -p'{DB_PASS}' -h 127.0.0.1 {DB_NAME} -e 'SHOW TABLES; DESCRIBE ops_records;' 2>&1"
)
print("6. Verify with app user:")
print(out or err)
assert code == 0 and "ops_records" in out, "App user cannot access table"

# 7. Write db_config.json
config = {"host": "127.0.0.1", "port": 3306, "user": DB_USER, "password": DB_PASS, "database": DB_NAME}
cfg_json = json.dumps(config)
code, out, err = run(
    f"mkdir -p /opt/ops-platform && printf '%s' '{cfg_json}' > /opt/ops-platform/db_config.json && chmod 600 /opt/ops-platform/db_config.json && echo SAVED"
)
print("7. db_config.json:", out or err)

client.close()
print("MYSQL_SETUP_DONE")
print("DB_PASS=" + DB_PASS)
