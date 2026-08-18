#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Re-upload app.js, restart service, full CRUD verification."""
import sys
import paramiko

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1]
LOCAL = r"C:/Users/hcfei/WorkBuddy/2026-08-18-11-37-38/standalone"
REMOTE = "/opt/ops-platform"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

def run(cmd, timeout=120):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    err = stderr.read().decode("utf-8", "replace").strip()
    code = stdout.channel.recv_exit_status()
    return code, out, err

# 1. Upload fixed app.js
sftp = client.open_sftp()
sftp.put(LOCAL + "/app.js", REMOTE + "/app.js")
sftp.close()
print("1. app.js uploaded")

# 2. Restart service
code, out, err = run("systemctl restart ops-platform && sleep 2 && systemctl is-active ops-platform")
print("2. service:", out or err)
assert "active" in (out + err), "service not active"

# 3. Verify GET /api/records (dates must be YYYY-MM-DD)
code, out, err = run("curl -s http://127.0.0.1/api/records | head -c 400")
print("3. GET /api/records:")
print(out)
assert '"2025-' in out, "date format still broken!"

# 4. CRUD round-trip: POST -> PUT -> DELETE
code, out, err = run(
    "curl -s -X POST http://127.0.0.1/api/records -H 'Content-Type: application/json' "
    "-d '{\"合同编号\":\"TEST-001\",\"项目名称\":\"CRUD验证项目\",\"客户名称\":\"测试客户\",\"合同金额\":12345,\"合同状态\":\"已签订\",\"签订日期\":\"2026-08-18\",\"备注\":\"crud test\"}'"
)
print("4. POST:", out)
assert '"id"' in out or '_id' in out, "POST failed"
import json as j
new_id = j.loads(out)["_id"]

code, out, err = run(
    "curl -s -X PUT http://127.0.0.1/api/records/" + new_id + " -H 'Content-Type: application/json' "
    "-d '{\"备注\":\"crud updated\",\"回款状态\":\"已回清\"}'"
)
print("   PUT:", out)
assert "ok" in out, "PUT failed"

code, out, err = run(
    "curl -s -X PUT http://127.0.0.1/api/records/999999 -H 'Content-Type: application/json' -d '{\"备注\":\"x\"}' -w ' [%{http_code}]'"
)
print("   PUT nonexistent:", out)

code, out, err = run("curl -s -X DELETE http://127.0.0.1/api/records/" + new_id)
print("   DELETE:", out)
assert "ok" in out, "DELETE failed"

# 5. Final count + page check
code, out, err = run("curl -s http://127.0.0.1/api/records | python3 -c 'import sys,json;print(\"records:\",len(json.load(sys.stdin)))'")
print("5.", out or err)
code, out, err = run("curl -s -o /dev/null -w 'page HTTP %{http_code}' http://127.0.0.1/")
print("6.", out or err)

client.close()
print("VERIFY_DONE")
