#!/usr/bin/env python3
"""Fix deployment: set up systemd service and verify."""
import sys, os, time, urllib.request

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1] if len(sys.argv) > 1 else ""
REMOTE_DIR = "/opt/ops-platform"

if not PASSWORD:
    print("ERROR: No password provided")
    sys.exit(1)

import paramiko

def ssh_exec(ssh, cmd, timeout=30, no_wait=False):
    """Execute command and return stdout/stderr. no_wait for quick fire-and-forget."""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    if no_wait:
        return "", "", 0
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    return out, err, code

print("[1/4] 连接服务器...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=15)
    print("  -> OK")
except Exception as e:
    print(f"  -> 连接失败: {e}")
    sys.exit(1)

# Check uploaded files
print("[2/4] 检查已上传文件...")
out, err, code = ssh_exec(ssh, f"ls -la {REMOTE_DIR}/")
print(out)

# Create systemd service
print("[3/4] 创建 systemd 服务...")
service = f"""[Unit]
Description=Ops Platform HTTP Server
After=network.target

[Service]
Type=simple
WorkingDirectory={REMOTE_DIR}
ExecStart=/usr/bin/python3 -m http.server 80 --bind 0.0.0.0
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
# Write service file using stdin to avoid quoting issues
stdin, stdout, stderr = ssh.exec_command(f"cat > /etc/systemd/system/ops-platform.service")
stdin.write(service)
stdin.flush()
stdin.channel.shutdown_write()
stdout.read()
stderr.read()

# Kill any lingering python http server on port 80, then start systemd service
ssh_exec(ssh, "fuser -k 80/tcp 2>/dev/null || true", no_wait=True)
time.sleep(1)
out, err, code = ssh_exec(ssh, "systemctl daemon-reload && systemctl enable ops-platform 2>&1 && systemctl restart ops-platform 2>&1 && sleep 1 && systemctl is-active ops-platform")
print(f"  -> 服务状态: {out.strip()}")

# Verify HTTP
print("[4/4] 验证 HTTP 访问...")
time.sleep(1)
try:
    req = urllib.request.Request(f"http://{HOST}/", headers={'Host': HOST, 'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, timeout=15)
    status = resp.getcode()
    content = resp.read(300).decode('utf-8', errors='replace')
    print(f"  -> HTTP {status}")
    if '运营管理平台' in content:
        print("  -> 页面标题验证通过 ✓")
    else:
        print(f"  -> 内容预览: {content[:150]}")
except Exception as e:
    print(f"  -> HTTP 验证失败: {e}")
    # Check service logs
    out, err, code = ssh_exec(ssh, "journalctl -u ops-platform --no-pager -n 20 2>&1")
    print("  服务日志:")
    print(out)

ssh.close()
print()
print("=" * 50)
print("  部署完成!")
print(f"  访问地址: http://{HOST}/")
print("=" * 50)
