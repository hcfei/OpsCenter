# -*- coding: utf-8 -*-
"""部署月度预算版前后端到远程服务器并验证 (预算按月 + 达成率周期化)"""
import sys, paramiko, time, json

HOST = '60.205.204.207'
USER = 'root'
PASSWORD = sys.argv[1]
REMOTE_DIR = '/opt/ops-platform'
FILES = ['app.js', '运营管理平台.html']

def run(cmd, timeout=90):
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

    print('== 3. 重启服务 (自动迁移预算表为月度) ==')
    out, err = run('systemctl restart ops-platform && sleep 4 && systemctl is-active ops-platform')
    print('  服务状态:', out.strip(), err.strip())
    time.sleep(1)

    print('== 4. 验证月度预算 API ==')
    out, err = run('curl -s "http://127.0.0.1:80/api/budget?year=2026"')
    print('  budget 原始返回:', out[:600])
    try:
        data = json.loads(out)
        print('  budget 条数:', len(data), '| 月份:', [d.get('月份') for d in data][:6], '...')
        print('  字段:', sorted(data[0].keys()) if data else '空')
        total = sum(d.get('预算收入', 0) for d in data)
        print('  全年预算收入合计:', total, '(预期 12000000)')
        q1 = sum(d.get('预算收入', 0) for d in data if d.get('月份', 0) <= 3)
        print('  Q1 预算收入:', q1, '(预期 2490000)')
        h1 = sum(d.get('预算收入', 0) for d in data if d.get('月份', 0) <= 6)
        print('  H1 预算收入:', h1, '(预期 5290000)')
    except Exception as e:
        print('  解析失败:', e)

    print('== 5. 验证 forecast / 页面 ==')
    out, err = run('curl -s http://127.0.0.1:80/api/forecast?year=2026 | head -c 200; echo; curl -s -o /dev/null -w "page:%{http_code}" http://127.0.0.1:80/')
    print(out)
    print(err)

    print('== 6. 验证 batch 覆盖接口 ==')
    test = json.dumps([{'年度': 2099, '月份': 1, '预算收入': 111, '预算贡献利润': 22, '预算现金流': 33, '预算费用': 4},
                       {'年度': 2099, '月份': 2, '预算收入': 222, '预算贡献利润': 33, '预算现金流': 44, '预算费用': 5}], ensure_ascii=False)
    out, err = run("curl -s -X POST http://127.0.0.1:80/api/budget/batch -H 'Content-Type: application/json' -d '" + test + "'")
    print('  batch:', out, err)
    out, err = run("curl -s -X DELETE http://127.0.0.1:80/api/budget/batch -X POST -H 'Content-Type: application/json' -d '" + json.dumps([{'年度': 2099, '月份': 1, '预算收入': 0, '预算贡献利润': 0, '预算现金流': 0, '预算费用': 0}], ensure_ascii=False) + "'")
    print('  cleanup:', out, err)
    # 清理 2099 测试数据
    out, err = run("curl -s -X POST http://127.0.0.1:80/api/budget/batch -H 'Content-Type: application/json' -d '" + json.dumps([], ensure_ascii=False) + "'")
    print('  cleanup-empty:', out, err)

    client.close()
    print('== 部署完成 ==')

if __name__ == '__main__':
    main()
