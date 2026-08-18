#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bind MySQL to 127.0.0.1 only, restart and verify app still works."""
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
    code = stdout.channel.recv_exit_status()
    return code, out, err

# 1. Write bind config
code, out, err = run(
    "cat > /etc/my.cnf.d/ops-bind.cnf <<'EOF'\n[mysqld]\nbind-address=127.0.0.1\nmysqlx-bind-address=127.0.0.1\nEOF\ncat /etc/my.cnf.d/ops-bind.cnf"
)
print("1. bind config:", out or err)

# 2. Restart mysqld
code, out, err = run("systemctl restart mysqld && sleep 4 && systemctl is-active mysqld")
print("2. mysqld:", out or err)
assert "active" in (out + err), "mysqld failed"

# 3. Verify 3306 now on 127.0.0.1 only
code, out, err = run("ss -tlnp 2>/dev/null | grep -E ':3306|:33060' || echo 'NONE'")
print("3. listeners:")
print(out or err)

# 4. Verify app still works (app connects via 127.0.0.1)
code, out, err = run("curl -s http://127.0.0.1/api/records | head -c 120; echo; curl -s -o /dev/null -w 'page HTTP %{http_code}\\n' http://127.0.0.1/")
print("4. app:", out or err)

client.close()
print("SEC_FIX_DONE")
