#!/usr/bin/env python3
"""SSH deploy script - upload files and configure web server on remote host."""
import sys, os, stat, io

HOST = "60.205.204.207"
USER = "root"
PASSWORD = sys.argv[1] if len(sys.argv) > 1 else ""
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))
REMOTE_DIR = "/opt/ops-platform"

if not PASSWORD:
    print("ERROR: No password provided")
    sys.exit(1)

import paramiko
from scp import SCPClient

def ssh_exec(ssh, cmd, timeout=60):
    """Execute command and return stdout/stderr."""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    return out, err, code

def progress(filename, size, sent):
    pct = int(sent * 100 / size) if size > 0 else 100
    sys.stdout.write(f"\r  {filename}: {pct}%")
    sys.stdout.flush()

print("=" * 50)
print("  运营管理平台远程部署")
print("=" * 50)
print()

# Step 1: Connect via SSH
print("[1/5] 连接服务器 %s ..." % HOST)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=15)
    print("  -> SSH 连接成功")
except Exception as e:
    print(f"  -> SSH 连接失败: {e}")
    sys.exit(1)

# Step 2: Check environment
print()
print("[2/5] 检查远程环境...")
out, err, code = ssh_exec(ssh, "uname -a")
print(f"  系统: {out.strip()}")
has_nginx = ssh_exec(ssh, "which nginx")[2] == 0
has_node = ssh_exec(ssh, "which node")[2] == 0
has_python3 = ssh_exec(ssh, "which python3")[2] == 0
print(f"  Nginx:  {'已安装' if has_nginx else '未安装'}")
print(f"  Node:   {'已安装' if has_node else '未安装'}")
print(f"  Python3: {'已安装' if has_python3 else '未安装'}")

# Step 3: Create remote directory and upload files
print()
print("[3/5] 上传文件...")
ssh_exec(ssh, f"mkdir -p {REMOTE_DIR}")
ssh_exec(ssh, f"chmod 755 {REMOTE_DIR}")

files_to_upload = [
    "运营管理平台.html",
    "server.js",
    "README.md"
]

scp = SCPClient(ssh.get_transport(), progress=progress, sanitize=lambda x: x)
for fname in files_to_upload:
    local_path = os.path.join(LOCAL_DIR, fname)
    if not os.path.exists(local_path):
        print(f"  跳过(本地不存在): {fname}")
        continue
    scp.put(local_path, REMOTE_DIR + "/" + fname)
    print()  # newline after progress

scp.close()
print("  -> 文件上传完成")

# Step 4: Configure web server
print()
print("[4/5] 配置 Web 服务...")

if has_nginx:
    # Configure Nginx
    nginx_conf = f"""server {{
    listen 80;
    server_name _;
    root {REMOTE_DIR};
    index 运营管理平台.html;
    charset utf-8;

    location / {{
        try_files $uri $uri/ /运营管理平台.html;
    }}

    location ~* \\.(js|css|png|jpg|svg|ico|woff|woff2|ttf|map)$ {{
        expires 30d;
        add_header Cache-Control "public, immutable";
    }}
}}
"""
    # Write nginx config
    ssh_exec(ssh, f"echo '{nginx_conf}' > /etc/nginx/conf.d/ops-platform.conf")
    # Test and reload nginx
    out, err, code = ssh_exec(ssh, "nginx -t 2>&1")
    if code == 0:
        ssh_exec(ssh, "systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || service nginx reload 2>/dev/null")
        print("  -> Nginx 配置完成并已 reload")
        web_server = "nginx"
    else:
        print(f"  -> Nginx 配置测试失败: {out}{err}")
        print("  -> 回退到 Python 服务器")
        web_server = "python"
else:
    web_server = "python"

if web_server == "python":
    # Kill any existing python http server on port 80
    ssh_exec(ssh, f"fuser -k 80/tcp 2>/dev/null; true")
    # Start Python http server in background
    start_cmd = f"""cd {REMOTE_DIR} && nohup python3 -m http.server 80 --bind 0.0.0.0 > /var/log/ops-platform.log 2>&1 &
    echo $!
    """
    out, err, code = ssh_exec(ssh, start_cmd)
    pid = out.strip()
    print(f"  -> Python HTTP 服务器已启动 (PID: {pid})")
    # Create systemd service for persistence
    service = """[Unit]
Description=Ops Platform HTTP Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ops-platform
ExecStart=/usr/bin/python3 -m http.server 80 --bind 0.0.0.0
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
    ssh_exec(ssh, f"cat > /etc/systemd/system/ops-platform.service << 'SERVICEEOF'\n{service}\nSERVICEOF")
    ssh_exec(ssh, "systemctl daemon-reload 2>/dev/null; systemctl enable ops-platform 2>/dev/null; systemctl restart ops-platform 2>/dev/null || true")
    print("  -> 已创建 systemd 服务 (开机自启)")

# Step 5: Verify deployment
print()
print("[5/5] 验证部署...")
import urllib.request
try:
    req = urllib.request.Request(f"http://{HOST}/", headers={'Host': HOST})
    resp = urllib.request.urlopen(req, timeout=10)
    status = resp.getcode()
    content = resp.read(200).decode('utf-8', errors='replace')
    if '运营管理平台' in content or '<html' in content.lower():
        print(f"  -> HTTP {status} - 页面正常返回")
    else:
        print(f"  -> HTTP {status} - 响应异常")
except Exception as e:
    print(f"  -> 验证失败: {e}")

# Final: List uploaded files
print()
print("远程文件列表:")
out, err, code = ssh_exec(ssh, f"ls -la {REMOTE_DIR}/")
print(out)

ssh.close()
print()
print("=" * 50)
print("  部署完成!")
print(f"  访问地址: http://{HOST}/")
print("=" * 50)
