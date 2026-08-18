#!/usr/bin/env python3
"""Verify new frontend via public IP."""
import sys, paramiko

PWD = sys.argv[1] if len(sys.argv) > 1 else ''
HOST = '60.205.204.207'
USER = 'root'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PWD, timeout=30)

stdin, stdout, stderr = ssh.exec_command('curl -s http://60.205.204.207/ | grep -oE "<title>[^<]+</title>|<meta charset|class=\"sidebar\"|class=\"kpi-card\"" | head -10')
out = stdout.read().decode().strip()
print(out)

ssh.close()
