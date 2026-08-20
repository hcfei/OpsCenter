#!/usr/bin/env python3
import paramiko
HOST = '60.205.204.207'
USER = 'root'
PWD = 'Hcfei@@@202606'
PORT = 22

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=PORT, username=USER, password=PWD, timeout=30)
stdin, stdout, stderr = ssh.exec_command('journalctl -u ops-platform --no-pager -n 50')
print(stdout.read().decode('utf-8', errors='ignore'))
print(stderr.read().decode('utf-8', errors='ignore'))
