#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Diagnose MariaDB service unit name and state."""
import sys
import paramiko

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

def run(cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    return out or err

print("== unit files ==")
print(run("systemctl list-unit-files | grep -iE 'maria|mysql' || echo NONE"))
print("== datadir ==")
print(run("ls -la /var/lib/mysql 2>/dev/null | head -8 || echo NO_DATADIR"))
print("== mariadb binary info ==")
print(run("which mariadbd mysqld 2>/dev/null; mariadbd --version 2>/dev/null || mysqld --version 2>/dev/null || echo NO_BIN"))
print("== rpm query ==")
print(run("rpm -q mariadb-server mariadb 2>&1"))
print("== firewalld ==")
print(run("systemctl is-active firewalld 2>/dev/null; firewall-cmd --state 2>/dev/null || echo NO_FIREWALLD"))

client.close()
print("DIAG_DONE")
