# -*- coding: utf-8 -*-
"""部署经营看板: 上传 app.js + 前端 HTML, 更新 index.html, 重启服务, 验证 API"""
import sys, time, io, json, urllib.request
import paramiko

HOST, USER, PWD = '60.205.204.207', 'root', sys.argv[1]
BASE = 'C:/Users/hcfei/WorkBuddy/2026-08-18-11-37-38/standalone'
REMOTE = '/opt/ops-platform'

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)
    sftp = ssh.open_sftp()

    files = [('app.js', 'app.js'), ('运营管理平台.html', '运营管理平台.html')]
    for local, remote in files:
        sftp.put(f'{BASE}/{local}', f'{REMOTE}/{remote}')
        print(f'[upload] {local} -> {REMOTE}/{remote}')

    def run(cmd):
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
        out = stdout.read().decode('utf-8', 'replace').strip()
        err = stderr.read().decode('utf-8', 'replace').strip()
        return out, err

    # 同步 index.html
    out, err = run(f'cd {REMOTE} && cp 运营管理平台.html index.html && ls -la index.html app.js 运营管理平台.html')
    print('[sync]', out or err)

    # 重启服务
    out, err = run('systemctl restart ops-platform && sleep 3 && systemctl is-active ops-platform')
    print('[service]', out or err)

    # 本机验证 API
    out, err = run("curl -s 'http://127.0.0.1/api/forecast?year=2026' | head -c 300")
    print('[forecast API]', out[:300] or err)
    out, err = run("curl -s http://127.0.0.1/ | grep -c '经营看板' || echo 0")
    print('[page has 经营看板]', out or err)
    out, err = run("curl -s http://127.0.0.1/api/records | head -c 120")
    print('[records API]', out[:120] or err)
    out, err = run("mysql -uops_app -p$(cat /opt/ops-platform/db_config.json | grep -o '\"password\"[^,]*' | cut -d'\"' -f4) -e 'SELECT year, COUNT(*) c FROM ops_platform.ops_forecast GROUP BY year' 2>/dev/null")
    print('[db forecast rows]', out or err or 'n/a')

    sftp.close()
    ssh.close()
    print('[done] 部署完成')

    # 公网验证
    try:
        with urllib.request.urlopen('http://60.205.204.207/api/forecast?year=2026', timeout=10) as r:
            data = json.loads(r.read().decode('utf-8'))
            print(f'[public] /api/forecast?year=2026 -> {len(data)} 条记录')
        with urllib.request.urlopen('http://60.205.204.207/', timeout=10) as r:
            html = r.read().decode('utf-8', 'replace')
            print(f'[public] 首页 HTTP {r.status}, 包含经营看板: {"经营看板" in html}')
    except Exception as e:
        print('[public] 验证失败:', e)

if __name__ == '__main__':
    main()
