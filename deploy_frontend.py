#!/usr/bin/env python3
"""Upload new frontend to remote server and restart service."""
import sys, paramiko, os

PWD = sys.argv[1] if len(sys.argv) > 1 else ''
HOST = '60.205.204.207'
USER = 'root'
LOCAL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '运营管理平台.html')
REMOTE_DIR = '/opt/ops-platform'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PWD, timeout=30)

# Upload HTML + index.html
sftp = ssh.open_sftp()
print('[upload] 运营管理平台.html')
sftp.put(LOCAL_FILE, f'{REMOTE_DIR}/运营管理平台.html')
print('[upload] index.html')
sftp.put(LOCAL_FILE, f'{REMOTE_DIR}/index.html')
sftp.close()

# Restart service
stdin, stdout, stderr = ssh.exec_command(f'cd {REMOTE_DIR} && systemctl restart ops-platform && sleep 1 && systemctl is-active ops-platform')
status = stdout.read().decode().strip()
err = stderr.read().decode().strip()
print('[service]', status, err)

# Verify page
stdin, stdout, stderr = ssh.exec_command(f'curl -s -o /dev/null -w "%{{http_code}}" http://localhost:8080/')
http = stdout.read().decode().strip()
print('[verify] HTTP', http)

# Verify title
stdin, stdout, stderr = ssh.exec_command(f'curl -s http://localhost:8080/ | grep -o "<title>.*</title>"')
title = stdout.read().decode().strip()
print('[verify] Title:', title)

ssh.close()
print('[done] 部署完成!')
