# -*- coding: utf-8 -*-
"""诊断 API 404 原因: 服务器本机 + 公网双路验证"""
import paramiko, sys, urllib.request

PASSWORD = sys.argv[1]
HOST = '60.205.204.207'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username='root', password=PASSWORD, timeout=20)

def run(cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    return out, err

print('=== 服务器本机 curl 测试 ===')
out, err = run('curl -s -o /dev/null -w "root: %{http_code}\\n" http://127.0.0.1/ && curl -s -o /dev/null -w "api: %{http_code}\\n" http://127.0.0.1/api/records && curl -s http://127.0.0.1/api/records | head -c 300')
print(out)

print('=== 服务监听状态 ===')
out, err = run('ss -tlnp | grep -E ":80|node" ; systemctl status ops-platform --no-pager | head -12')
print(out)

client.close()
