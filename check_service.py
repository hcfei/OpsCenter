#!/usr/bin/env python3
"""Check service status and fix port if needed."""
import sys, paramiko

PWD = sys.argv[1] if len(sys.argv) > 1 else ''
HOST = '60.205.204.207'
USER = 'root'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PWD, timeout=30)

# Check service config and status
for cmd in [
    'systemctl status ops-platform --no-pager | head -20',
    'cat /etc/systemd/system/ops-platform.service',
    'ss -tlnp | grep -E "(80|8080|3000)"',
    'curl -s -o /dev/null -w "%{http_code}" http://localhost:80/',
    'curl -s http://localhost:80/ | head -3',
]:
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print(f'$ {cmd}')
    print(out or err or '(empty)')
    print()

ssh.close()
