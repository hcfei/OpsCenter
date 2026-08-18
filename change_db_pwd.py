# -*- coding: utf-8 -*-
"""修改 MySQL root/ops_app 密码, 同步 db_config.json 并重启验证"""
import paramiko, json, sys, urllib.request

PASSWORD = sys.argv[1]
HOST = '60.205.204.207'
NEW_ROOT_PWD = 'root'
NEW_APP_PWD = 'ops_app'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username='root', password=PASSWORD, timeout=20)

def run(cmd, timeout=90):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    return out, err

print('=== 1. 读取当前 db_config.json ===')
out, err = run('cat /opt/ops-platform/db_config.json')
if 'No such file' in out or 'No such file' in err:
    print('FATAL: db_config.json 不存在'); sys.exit(1)
config = json.loads(out.strip())
old_pass = config.get('password', '')
print('当前应用用户:', config.get('user'), '| 密码长度:', len(old_pass))

print('=== 2. 尝试登录 MySQL root ===')
candidates = [old_pass, 'root', '']
MYSQL = None
for pw in candidates:
    prefix = "mysql -uroot -p'%s'" % pw if pw else 'mysql -uroot'
    out, err = run(prefix + " -e \"SELECT 1;\" 2>&1")
    if 'ERROR' not in out and 'Access denied' not in out:
        MYSQL = prefix
        print('root 当前可用密码:', repr(pw))
        break
if MYSQL is None:
    out, err = run("mysql -e \"SELECT 1;\" 2>&1")
    if 'ERROR' not in out:
        MYSQL = 'mysql'
        print('root 通过 socket 认证可用')
    else:
        print('FATAL: 无法登录 MySQL, 输出:', out); sys.exit(1)

print('=== 3. 查询 root/ops_app 用户 host 列表 ===')
out, err = run(MYSQL + " -N -e \"SELECT user, host FROM mysql.user WHERE user IN ('root','ops_app');\" 2>&1")
print(out.strip())
users = []
for line in out.strip().splitlines():
    parts = line.split('\t')
    if len(parts) == 2:
        users.append(tuple(parts))

print('=== 4. 修改密码 ===')
sql_parts = []
for u, h in users:
    newp = NEW_ROOT_PWD if u == 'root' else NEW_APP_PWD
    sql_parts.append("ALTER USER '%s'@'%s' IDENTIFIED BY '%s';" % (u, h, newp))
sql_parts.append("FLUSH PRIVILEGES;")
sql = ' '.join(sql_parts)
out, err = run(MYSQL + " -e \"" + sql + "\" 2>&1")
print('ALTER 输出:', out.strip() or '(空, 成功)')

print('=== 5. 更新 db_config.json ===')
config['password'] = NEW_APP_PWD
new_json = json.dumps(config, ensure_ascii=False, indent=2)
sftp = client.open_sftp()
with sftp.open('/opt/ops-platform/db_config.json', 'w') as f:
    f.write(new_json)
sftp.close()
run('chmod 600 /opt/ops-platform/db_config.json')
print('已写入新密码 ops_app')

print('=== 6. 重启 ops-platform 服务 ===')
out, err = run('systemctl restart ops-platform && sleep 3 && systemctl is-active ops-platform')
print('服务状态:', out.strip())

print('=== 7. 验证新密码 ===')
out, err = run("mysql -uroot -proot -e \"SELECT VERSION() AS v;\" 2>&1")
print('root/root:', out.strip())
out, err = run("mysql -uops_app -pops_app -h127.0.0.1 ops_platform -e \"SELECT COUNT(*) AS cnt FROM ops_records;\" 2>&1")
print('ops_app/ops_app:', out.strip())

print('=== 8. 验证 API ===')
try:
    resp = urllib.request.urlopen('http://127.0.0.1/api/records', timeout=15)
    data = resp.read().decode('utf-8')
    print('API HTTP', resp.status, '| 返回字节数:', len(data))
except Exception as e:
    print('API 验证失败:', e)

client.close()
print('=== 完成 ===')
