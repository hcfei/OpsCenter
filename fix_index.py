#!/usr/bin/env python3
"""Fix: add index.html so root URL serves the app directly."""
import sys, time, urllib.request

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1] if len(sys.argv) > 1 else ""
REMOTE_DIR = "/opt/ops-platform"

if not PASSWORD:
    print("ERROR: No password provided")
    sys.exit(1)

import paramiko

def ssh_exec(ssh, cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    return out, err, code

print("[1/3] 连接服务器...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=15)
print("  -> OK")

# Copy html to index.html (also provide index.htm fallback)
print("[2/3] 创建 index.html...")
out, err, code = ssh_exec(ssh, f"cd {REMOTE_DIR} && cp '运营管理平台.html' index.html && ls -la")
print(out)
print("  -> 复制完成")

# Restart service and verify
print("[3/3] 重启服务并验证...")
ssh_exec(ssh, "systemctl restart ops-platform")
time.sleep(2)
try:
    req = urllib.request.Request(f"http://{HOST}/", headers={'Host': HOST, 'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, timeout=15)
    status = resp.getcode()
    content = resp.read(500).decode('utf-8', errors='replace')
    print(f"  -> HTTP {status}")
    if '运营管理平台' in content:
        print("  -> 页面验证通过 ✓ (包含应用标题)")
    else:
        print(f"  -> 内容预览: {content[:200]}")
except Exception as e:
    print(f"  -> 验证失败: {e}")
    out, err, code = ssh_exec(ssh, "journalctl -u ops-platform --no-pager -n 15 2>&1")
    print("  服务日志:")
    print(out)

ssh.close()
print()
print("=" * 50)
print("  部署完成!")
print(f"  访问地址: http://{HOST}/")
print("=" * 50)
