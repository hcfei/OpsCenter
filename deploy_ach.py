# -*- coding: utf-8 -*-
"""部署达成率版前后端到远程服务器并验证 (预算 API + 页面)"""
import sys, paramiko, time

HOST = '60.205.204.207'
USER = 'root'
PASSWORD = sys.argv[1]
REMOTE_DIR = '/opt/ops-platform'
FILES = ['app.js', '运营管理平台.html']

def run(cmd, timeout=60):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    client.close()
    return out, err

def main():
    print('== 1. 上传文件 ==')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    sftp = client.open_sftp()
    for f in FILES:
        sftp.put(f, f'{REMOTE_DIR}/{f}')
        print(f'  -> {f} 上传完成')
    sftp.close()

    print('== 2. 同步 index.html ==')
    out, err = run(f'cp {REMOTE_DIR}/运营管理平台.html {REMOTE_DIR}/index.html && echo INDEX_OK')
    print(' ', out.strip(), err.strip())

    print('== 3. 重启服务 ==')
    out, err = run('systemctl restart ops-platform && sleep 3 && systemctl is-active ops-platform')
    print('  服务状态:', out.strip(), err.strip())

    print('== 4. 本地验证 API ==')
    time.sleep(1)
    out, err = run('curl -s http://127.0.0.1:80/api/budget?year=2026; echo; curl -s http://127.0.0.1:80/api/forecast?year=2026 | head -c 200; echo; curl -s -o /dev/null -w "page:%{http_code}" http://127.0.0.1:80/')
    print(out)
    print(err)
    client.close()
    print('== 部署完成 ==')

if __name__ == '__main__':
    main()
