#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Diagnose MySQL root auth method and continue initialization."""
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

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

def run(cmd, timeout=120):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out, err

print("== log files ==")
print(run("ls -la /var/log/mysqld.log /var/log/mysql/ 2>&1 | head -10"))
print("== journal temp password ==")
print(run("journalctl -u mysqld --no-pager 2>/dev/null | grep -iE 'temporary|password' | tail -5 || echo NONE"))
print("== try root no password ==")
code, out, err = run("mysql -uroot -e 'SELECT 1' 2>&1")
print("code:", code, "|", out or err)
print("== try root via socket no password ==")
code, out, err = run("mysql --socket=/var/lib/mysql/mysql.sock -uroot -e 'SELECT VERSION(); SELECT user,host,plugin FROM mysql.user;' 2>&1")
print("code:", code, "|", out or err)

client.close()
print("DIAG3_DONE")
