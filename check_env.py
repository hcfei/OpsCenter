#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check remote server environment: MySQL/MariaDB, Node, Python, pip packages."""
import sys
import paramiko

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1]

CMDS = [
    ("MySQL/MariaDB binary", "which mysql mariadb mysqld mariadbd 2>/dev/null || echo 'NONE'"),
    ("MySQL/MariaDB package", "rpm -qa 2>/dev/null | grep -iE 'mysql|mariadb' || echo 'NONE'"),
    ("MySQL service", "systemctl list-units --type=service 2>/dev/null | grep -iE 'mysql|maria' || echo 'NONE'"),
    ("Node", "which node 2>/dev/null && node -v 2>/dev/null || echo 'NONE'"),
    ("npm", "which npm 2>/dev/null && npm -v 2>/dev/null || echo 'NONE'"),
    ("Python3", "which python3 2>/dev/null && python3 -V 2>/dev/null || echo 'NONE'"),
    ("pip3", "which pip3 2>/dev/null || echo 'NONE'"),
    ("pymysql", "python3 -c 'import pymysql; print(\"pymysql\", pymysql.__version__)' 2>/dev/null || echo 'NO_PYMYSQL'"),
    ("dnf", "which dnf 2>/dev/null || echo 'NONE'"),
    ("OS", "cat /etc/os-release 2>/dev/null | head -2"),
    ("Existing ops dir", "ls -la /opt/ops-platform 2>/dev/null || echo 'NO_DIR'"),
    ("Port 80 status", "ss -tlnp 2>/dev/null | grep ':80 ' || echo 'PORT80_FREE'"),
    ("systemd ops", "systemctl status ops-platform 2>/dev/null | head -5 || echo 'NO_OPS_SERVICE'"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

for title, cmd in CMDS:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    print(f"===== {title} =====")
    print(out if out else err if err else "(empty)")
    print()

client.close()
print("CHECK_DONE")
