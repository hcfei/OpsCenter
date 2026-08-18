#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Find dnf exclude rules blocking mysql packages."""
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

print("== dnf.conf ==")
print(run("cat /etc/dnf/dnf.conf 2>/dev/null | grep -n 'exclude' || echo 'no exclude in dnf.conf'"))
print("== repo exclude lines ==")
print(run("grep -rn 'exclude' /etc/yum.repos.d/ 2>/dev/null | head -20 || echo 'none'"))
print("== all excludes effective ==")
print(run("dnf repolist 2>&1 | tail -8"))
print("== try: dnf install mysql-server with exclude override ==")
print(run("dnf install -y mysql-server --setopt=exclude= --skip-broken 2>&1 | tail -6", timeout=300))

client.close()
print("DIAG2_DONE")
