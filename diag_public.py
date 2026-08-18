# -*- coding: utf-8 -*-
"""服务器上通过公网 IP 自测 API 响应"""
import paramiko, sys

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

print('=== 服务器上请求公网 IP (自回路) ===')
out, err = run('curl -s -o /dev/null -w "records: %{http_code} | %{size_download} bytes\\n" --max-time 15 http://60.205.204.207/api/records; curl -s --max-time 15 http://60.205.204.207/api/records | head -c 200; echo ""')
print(out)

print('=== 服务器上请求本机 ===')
out, err = run('curl -s --max-time 15 http://127.0.0.1/api/records | head -c 200; echo ""')
print(out)

print('=== node 服务日志 ===')
out, err = run('journalctl -u ops-platform --no-pager -n 15 | tail -15')
print(out)

client.close()
