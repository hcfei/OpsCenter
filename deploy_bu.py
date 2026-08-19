# -*- coding: utf-8 -*-
"""部署 BU 化版本: 上传 app.js + 运营管理平台.html → 同步 index.html → 重启服务
→ 验证迁移日志 (ops_forecast/ops_budget 加 bu 列, ops_actual 建表+种子)
→ 接口冒烟测试 (forecast/budget/actual 按 BU 查询, actual batch 写入, 汇总聚合)
→ 公网验证
用法: python deploy_bu.py <服务器root密码>
"""
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
        print(f'[upload] {local} -> {REMOTE}/{remote} ({sftp.stat(f"{REMOTE}/{remote}").st_size} bytes)')

    def run(cmd):
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
        out = stdout.read().decode('utf-8', 'replace').strip()
        err = stderr.read().decode('utf-8', 'replace').strip()
        return out, err

    out, err = run(f'cd {REMOTE} && cp 运营管理平台.html index.html && ls -la index.html app.js 运营管理平台.html')
    print('[sync]', out or err)

    # 重启并抓启动日志验证迁移
    out, err = run(f'systemctl restart ops-platform && sleep 4 && systemctl is-active ops-platform && journalctl -u ops-platform -n 25 --no-pager | grep -E "migrate|init|actual|budget|forecast" ')
    print('[service+log]', out or err)

    def q(api):
        out, err = run(f"curl -s 'http://127.0.0.1{api}' | head -c 600")
        return out

    print('\n===== 接口冒烟测试 =====')
    out = q('/api/forecast/versions')
    print('[versions]', out[:400] or '(empty)')
    out = q('/api/forecast?fcMonth=202608&version=V1&year=2026&bu=%E6%B1%87%E6%80%BB')
    print('[forecast 汇总]', out[:300] or '(empty)')
    out = q('/api/budget?year=2026&bu=%E6%B1%87%E6%80%BB')
    print('[budget 汇总]', out[:200] or '(empty)')
    out = q('/api/actual?year=2026&bu=%E8%BD%AF%E5%B7%A5')
    print('[actual 软工]', out[:300] or '(empty)')
    out = q('/api/actual?year=2026&bu=%E6%B1%87%E6%80%BB')
    print('[actual 汇总聚合]', out[:300] or '(empty)')

    # actual batch: 汇总必须 400
    out, err = run(f"curl -s -X POST http://127.0.0.1/api/actual/batch -H 'Content-Type: application/json' -d '{{\"bu\":\"汇总\",\"records\":[{{\"年度\":2026,\"月份\":1,\"实际收入\":1}}]}}'")
    print('[actual batch 汇总→400]', out[:200] or err)

    # actual batch: 硬工 2027 年 2 条 (种子仅在 2026, 2027 无数据不污染), 验证后删除
    out, err = run(f"curl -s -X POST http://127.0.0.1/api/actual/batch -H 'Content-Type: application/json' -d '{{\"bu\":\"硬工\",\"records\":[{{\"年度\":2027,\"月份\":1,\"实际收入\":100,\"实际贡献利润\":20,\"实际现金流\":30,\"实际费用\":5}},{{\"年度\":2027,\"月份\":2,\"实际收入\":200,\"实际贡献利润\":40,\"实际现金流\":60,\"实际费用\":10}}]}}'")
    print('[actual batch 硬工2027→写]', out[:200] or err)
    out, err = run(f"mysql -uops_app -p$(cat /opt/ops-platform/db_config.json | grep -o '\"password\"[^,]*' | cut -d'\"' -f4) -N -e \"SELECT COUNT(*) FROM ops_platform.ops_actual WHERE year=2027 AND bu='硬工'; DELETE FROM ops_platform.ops_actual WHERE year=2027; SELECT COUNT(*) FROM ops_platform.ops_actual WHERE year=2027;\" 2>/dev/null")
    print('[db 2027 写入数/清理后]', out.replace('\n', ' | ') or 'n/a')

    # DB 结构验证
    out, err = run(f"mysql -uops_app -p$(cat /opt/ops-platform/db_config.json | grep -o '\"password\"[^,]*' | cut -d'\"' -f4) -N -e \"SELECT COUNT(*) FROM ops_platform.ops_actual; SELECT bu,COUNT(*) FROM ops_platform.ops_actual GROUP BY bu; SELECT COUNT(DISTINCT bu) FROM ops_platform.ops_forecast; SELECT COUNT(DISTINCT bu) FROM ops_platform.ops_budget;\" 2>/dev/null")
    print('[db actual 行数/BU分布 / forecast bu数 / budget bu数]', out.replace('\n', ' | ') or 'n/a')

    sftp.close()
    ssh.close()
    print('[done] 部署+冒烟完成')

    # 公网验证
    try:
        with urllib.request.urlopen('http://60.205.204.207/api/actual?year=2026&bu=%E6%B1%87%E6%80%BB', timeout=10) as r:
            data = json.loads(r.read().decode('utf-8'))
            print(f'[public] /api/actual 汇总聚合 -> {len(data)} 个月')
        with urllib.request.urlopen('http://60.205.204.207/', timeout=10) as r:
            html = r.read().decode('utf-8', 'replace')
            print(f'[public] 首页 HTTP {r.status}, {len(html)} bytes, 含 BU 下拉: {"fcBuSel" in html}')
    except Exception as e:
        print('[public] 验证失败:', e)

if __name__ == '__main__':
    main()
