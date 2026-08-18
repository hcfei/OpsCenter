#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy MySQL-backed ops platform: upload app.js + HTML, install deps, update systemd."""
import sys
import paramiko

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1]
LOCAL = r"C:/Users/hcfei/WorkBuddy/2026-08-18-11-37-38/standalone"
REMOTE = "/opt/ops-platform"

FILES = ["app.js", "package.json", "运营管理平台.html", "README.md"]

UNIT = """[Unit]
Description=Ops Platform - Node.js + MySQL
After=network.target mysqld.service
Wants=mysqld.service

[Service]
Type=simple
WorkingDirectory=/opt/ops-platform
ExecStart=/usr/bin/node /opt/ops-platform/app.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
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

# 1. Upload files via SFTP
sftp = client.open_sftp()
for f in FILES:
    sftp.put(LOCAL + "/" + f, REMOTE + "/" + f)
    print("1. uploaded", f)
sftp.close()

# 2. Sync index.html
code, out, err = run("cp -f " + REMOTE + "/运营管理平台.html " + REMOTE + "/index.html && ls -la " + REMOTE)
print("2. index.html synced:")
print(out or err)

# 3. npm install mysql2
print("3. npm install (mysql2)...")
code, out, err = run("cd " + REMOTE + " && npm install --omit=dev 2>&1 | tail -6")
print(out or err)
code, out, err = run("ls " + REMOTE + "/node_modules/mysql2/package.json 2>/dev/null && echo MYSQL2_OK || echo MYSQL2_MISSING")
print("   ", out)
assert "MYSQL2_OK" in out, "mysql2 install failed"

# 4. Update systemd unit
code, out, err = run("cat > /etc/systemd/system/ops-platform.service <<'EOF'\n" + UNIT + "EOF\nsystemctl daemon-reload && echo UNIT_UPDATED")
print("4. unit updated:", out or err)

# 5. Restart service
code, out, err = run("systemctl restart ops-platform && sleep 3 && systemctl is-active ops-platform")
print("5. service active:", out or err)
assert "active" in (out + err), "ops-platform service failed"

# 6. Verify API + page
code, out, err = run("curl -s http://127.0.0.1/api/records | head -c 300; echo; curl -s -o /dev/null -w 'HTTP %{http_code}\\n' http://127.0.0.1/")
print("6. verify:")
print(out or err)
code, out, err = run("journalctl -u ops-platform --no-pager -n 12 2>/dev/null | tail -12")
print("7. service log:")
print(out or err)

client.close()
print("DEPLOY_DONE")
