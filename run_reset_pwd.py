# -*- coding: utf-8 -*-
"""重置 MySQL root/ops_app 密码 -> root/ops_app, 同步 db_config.json, 重启并验证"""
import paramiko, json, sys, urllib.request

PASSWORD = sys.argv[1]
HOST = '60.205.204.207'
NEW_APP_PWD = 'ops_app'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username='root', password=PASSWORD, timeout=20)

def run(cmd, timeout=180):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    return out, err

print('=== A. 上传重置脚本并执行 ===')
sftp = client.open_sftp()
sftp.put('reset_pwd.sh', '/tmp/reset_pwd.sh')
sftp.close()
out, err = run('bash /tmp/reset_pwd.sh 2>&1')
print(out)
if 'Access denied' in out or '=== DONE ===' not in out:
    print('FATAL: 密码重置失败'); sys.exit(1)

print('=== B. 更新 db_config.json ===')
out, err = run('cat /opt/ops-platform/db_config.json')
config = json.loads(out.strip())
config['password'] = NEW_APP_PWD
sftp = client.open_sftp()
with sftp.open('/opt/ops-platform/db_config.json', 'w') as f:
    f.write(json.dumps(config, ensure_ascii=False, indent=2))
sftp.close()
run('chmod 600 /opt/ops-platform/db_config.json')
print('db_config.json 已更新 (user=%s)' % config.get('user'))

print('=== C. 重启应用服务 ===')
out, err = run('systemctl restart ops-platform && sleep 3 && systemctl is-active ops-platform')
print('ops-platform:', out.strip())

print('=== D. 验证 API ===')
try:
    resp = urllib.request.urlopen('http://127.0.0.1/api/records', timeout=15)
    data = resp.read().decode('utf-8')
    print('API HTTP', resp.status, '| 返回字节数:', len(data))
except Exception as e:
    print('API 验证失败:', e)

client.close()
print('=== 完成 ===')
