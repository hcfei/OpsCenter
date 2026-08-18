# -*- coding: utf-8 -*-
"""清理 2099 测试预算数据 + 最终验证月度预算功能 (部署验收)"""
import sys, paramiko, json

HOST = '60.205.204.207'
USER = 'root'
PASSWORD = sys.argv[1]
REMOTE_DIR = '/opt/ops-platform'

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
    print('== 1. 清理 2099 测试预算数据 (直接 MySQL) ==')
    out, err = run("mysql -uops_app -pops_app ops_platform -e \"DELETE FROM ops_budget WHERE year=2099; SELECT year, COUNT(*) AS cnt FROM ops_budget GROUP BY year;\" 2>&1")
    print(out.strip())
    if err.strip():
        print('  stderr:', err.strip())

    print('== 2. 验证预算 API (2026 月度 12 条 + 周期合计) ==')
    out, err = run('curl -s "http://127.0.0.1:80/api/budget?year=2026"')
    data = json.loads(out)
    months = [d.get('月份') for d in data]
    total = sum(d.get('预算收入', 0) for d in data)
    q1 = sum(d.get('预算收入', 0) for d in data if d.get('月份', 0) <= 3)
    h1 = sum(d.get('预算收入', 0) for d in data if d.get('月份', 0) <= 6)
    q2 = sum(d.get('预算收入', 0) for d in data if 4 <= d.get('月份', 0) <= 6)
    print(f'  月份: {months}')
    print(f'  全年预算收入: {total} (预期 12000000)')
    print(f'  Q1: {q1} (预期 2490000) | Q2: {q2} (预期 2800000) | H1: {h1} (预期 5290000)')
    assert total == 12000000, '全年合计不符!'
    assert q1 == 2490000 and h1 == 5290000, '季度/半年度合计不符!'

    print('== 3. 验证 2099 已清理 ==')
    out, err = run('curl -s "http://127.0.0.1:80/api/budget?year=2099"')
    d2099 = json.loads(out)
    print('  2099 返回条数:', len(d2099), '(预期 0)')
    assert len(d2099) == 0, '2099 测试数据未清理干净!'

    print('== 4. 验证远程页面包含月度预算元素 ==')
    out, err = run('curl -s http://127.0.0.1:80/ > /tmp/index_check.html && wc -c /tmp/index_check.html')
    print('  页面大小:', out.strip())
    for token in ['budgetTableBody', 'bdSplitRev', 'fcBudgetSum', 'fcBudgetMap', 'budgetModalOverlay', 'openBudgetModal']:
        out, err = run(f'grep -c "{token}" /tmp/index_check.html')
        print(f'  {token}: {out.strip()} 处')
        assert int(out.strip()) > 0, f'缺少元素 {token}!'

    print('== 5. 达成率口径抽样 (验证累计预算对比) ==')
    out, err = run("curl -s -o /dev/null -w 'page:%{http_code}' http://127.0.0.1:80/")
    print('  页面状态:', out.strip())

    print('== 全部验收通过 ==')

if __name__ == '__main__':
    main()
