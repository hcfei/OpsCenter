#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check available database server packages via dnf."""
import sys
import paramiko

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

def run(cmd, timeout=120):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    return out or err

print("== dnf list mariadb-server ==")
print(run("dnf list available mariadb-server 2>&1 | tail -6"))
print("== dnf list mysql-server ==")
print(run("dnf list available mysql-server 2>&1 | tail -6"))
print("== dnf search mysql ==")
print(run("dnf search mysql 2>&1 | grep -iE 'server|community' | head -8"))

client.close()
print("PKG_DONE")
