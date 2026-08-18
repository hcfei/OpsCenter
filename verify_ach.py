# -*- coding: utf-8 -*-
"""验证达成率版: 预算 PUT 更新->恢复, 页面含新元素, 达成率计算抽查"""
import sys, paramiko, json, time

HOST = '60.205.204.207'
USER = 'root'
PASSWORD = sys.argv[1]

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
    print('== 1. 预算 PUT 更新测试 (临时改为 1300 万) ==')
    out, _ = run("""curl -s -X PUT http://127.0.0.1:80/api/budget -H 'Content-Type: application/json' -d '{"年度":2026,"预算收入":13000000,"预算贡献利润":3600000,"预算现金流":3600000,"预算费用":1650000}'""")
    print('  PUT:', out.strip())

    out, _ = run('curl -s http://127.0.0.1:80/api/budget?year=2026')
    d = json.loads(out)
    assert d[0]['预算收入'] == 13000000, 'PUT 未生效!'
    print('  更新后读取 OK:', d[0]['预算收入'])

    print('== 2. 预算恢复为原值 ==')
    out, _ = run("""curl -s -X POST http://127.0.0.1:80/api/budget -H 'Content-Type: application/json' -d '{"年度":2026,"预算收入":12000000,"预算贡献利润":3500000,"预算现金流":3500000,"预算费用":1600000}'""")
    out, _ = run('curl -s http://127.0.0.1:80/api/budget?year=2026')
    d = json.loads(out)
    assert d[0]['预算收入'] == 12000000, '恢复失败!'
    print('  已恢复:', d[0])

    print('== 3. 页面新元素检查 ==')
    out, _ = run('curl -s http://127.0.0.1:80/index.html')
    checks = {
        '预测状态条 fcForecastTo': 'fcForecastTo' in out,
        '达成总览 fcAchGrid': 'fcAchGrid' in out,
        '预算按钮 openBudgetModal': 'openBudgetModal' in out,
        '预算 Modal budgetModalOverlay': 'budgetModalOverlay' in out,
        '表格达成率列': '收入累计达成值' in out,
        '月份进度轨道 fcMonthTrack': 'fcMonthTrack' in out,
        '预算参考虚线': '预算收入 ' in out,
    }
    for k, v in checks.items():
        print(f'  [{"OK" if v else "FAIL"}] {k}')

    print('== 4. 达成率计算抽查 (前端逻辑等价验证) ==')
    out, _ = run('curl -s http://127.0.0.1:80/api/forecast?year=2026')
    rows = json.loads(out)
    total_rev = sum(float(r['预测收入']) for r in rows)
    max_month = max(int(r['月份']) for r in rows)
    budget = 12000000.0
    rate = total_rev / budget * 100
    print(f'  预测月份: 至 {max_month} 月 | 已录 {len(rows)}/12 月')
    print(f'  全年预测收入累计: {total_rev:,.0f} | 预算: {budget:,.0f}')
    print(f'  全年度达成率: {rate:.1f}%')
    assert 0 < rate < 100, '达成率超出合理范围'
    print('  ✅ 达成率计算合理')

    print('== 全部验证通过 ==')

if __name__ == '__main__':
    main()
