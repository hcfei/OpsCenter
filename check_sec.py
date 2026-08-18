#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check MySQL listening address (should be 127.0.0.1 only)."""
import sys
import paramiko

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

def run(cmd, timeout=30):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    return out or err

print("== port 3306 listeners ==")
print(run("ss -tlnp 2>/dev/null | grep ':3306' || echo '3306 not listening'"))
print("== bind address in config ==")
print(run("grep -rn 'bind-address' /etc/my.cnf /etc/my.cnf.d/ 2>/dev/null || echo 'no bind-address set (default 127.0.0.1 on RHEL family)'"))
print("== port 80 ==")
print(run("ss -tlnp 2>/dev/null | grep ':80 ' || echo '80 not listening'"))

client.close()
print("SEC_CHECK_DONE")
