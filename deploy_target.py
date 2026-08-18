# -*- coding: utf-8 -*-
"""部署预算目标拆分模块到远程服务器并验证 (ops_target_split: 指标xBU = 15条)"""
import sys, paramiko, time, json

HOST = '60.205.204.207'
USER = 'root'
PASSWORD = sys.argv[1]
REMOTE_DIR = '/opt/ops-platform'
FILES = ['app.js', '运营管理平台.html']

def ssh(cmd, timeout=90):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    client.close()
    return out, err

def main():
    print('== 1. 上传 app.js / 运营管理平台.html ==')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    sftp = client.open_sftp()
    for f in FILES:
        sftp.put(f, '%s/%s' % (REMOTE_DIR, f))
        print('  ->', f, '上传完成')
    sftp.close()

    print('== 2. 同步 index.html ==')
    out, err = ssh('cp %s/运营管理平台.html %s/index.html && echo INDEX_OK' % (REMOTE_DIR, REMOTE_DIR))
    print(' ', out.strip(), err.strip())

    print('== 3. 重启服务 (自动建表+写入15条种子) ==')
    out, err = ssh('systemctl restart ops-platform && sleep 5 && systemctl is-active ops-platform')
    print('  服务状态:', out.strip(), err.strip())
    time.sleep(1)

    print('== 4. 验证 /api/target-split ==')
    out, err = ssh('curl -s "http://127.0.0.1:80/api/target-split"')
    data = json.loads(out)
    print('  条数:', len(data), '(预期 15)')
    order = [(d.get('指标'), d.get('BU')) for d in data]
    expect = []
    for m in ['收入', '贡献利润', '现金流']:
        for b in ['软工', '硬工', '云', '智能汽车', '汇总']:
            expect.append((m, b))
    print('  排序正确:', order == expect)
    # 汇总校验: 各指标 YTD 实际/目标, BU 之和 vs 汇总行
    by = {}
    for d in data:
        by.setdefault(d.get('指标'), {})[d.get('BU')] = d
    for m in ['收入', '贡献利润', '现金流']:
        s_act = sum(by[m][b]['YTD实际'] for b in ['软工', '硬工', '云', '智能汽车'])
        s_tgt = sum(by[m][b]['YTD目标'] for b in ['软工', '硬工', '云', '智能汽车'])
        print('  %s YTD: BU合计实际=%.6f 汇总=%.6f | BU合计目标=%.6f 汇总=%.6f' % (
            m, s_act, by[m]['汇总']['YTD实际'], s_tgt, by[m]['汇总']['YTD目标']))
    print('  收入/汇总 YTD: 实际=%.6f 目标=%.6f (预期 250819.252629 / 250819.252630)' % (
        by['收入']['汇总']['YTD实际'], by['收入']['汇总']['YTD目标']))
    print('  达成率(前端口径): 收入YTD = %.2f%%' % (by['收入']['汇总']['YTD实际'] / by['收入']['汇总']['YTD目标'] * 100))

    print('== 5. CRUD 冒烟测试 (临时记录, 测完删除) ==')
    tmp = {'指标': '收入', 'BU': '测试BU', 'Q1实际': 1.1, 'Q2实际': 2.2, 'Q3实际': 3.3, 'Q4实际': 4.4,
           'H1实际': 3.3, 'H2实际': 7.7, 'YTD实际': 11.0, 'Q1目标': 10, 'Q2目标': 20, 'Q3目标': 30,
           'Q4目标': 40, 'H1目标': 30, 'H2目标': 70, 'YTD目标': 100}
    payload = json.dumps(tmp, ensure_ascii=False)
    out, err = ssh("curl -s -X POST http://127.0.0.1:80/api/target-split -H 'Content-Type: application/json' -d '" + payload + "'")
    print('  POST:', out.strip(), err.strip())
    out, err = ssh('curl -s "http://127.0.0.1:80/api/target-split"')
    data2 = json.loads(out)
    found = [d for d in data2 if d.get('BU') == '测试BU']
    tid = found[0]['_id'] if found else None
    print('  POST 后条数:', len(data2), '| 测试记录 id:', tid)
    # PUT 更新 (维度不可改, 只改数值)
    upd = dict(tmp); upd['YTD实际'] = 55.5
    payload2 = json.dumps(upd, ensure_ascii=False)
    out, err = ssh("curl -s -X PUT http://127.0.0.1:80/api/target-split/%s -H 'Content-Type: application/json' -d '%s'" % (tid, payload2))
    print('  PUT:', out.strip(), err.strip())
    out, err = ssh('curl -s "http://127.0.0.1:80/api/target-split"')
    data3 = json.loads(out)
    upd_rec = [d for d in data3 if d.get('BU') == '测试BU'][0]
    print('  PUT 后 YTD实际:', upd_rec.get('YTD实际'), '(预期 55.5)')
    # 维度冲突 upsert: 同 metric+BU 再次 POST 应更新而非新增
    out, err = ssh("curl -s -X POST http://127.0.0.1:80/api/target-split -H 'Content-Type: application/json' -d '" + payload2 + "'")
    out, err = ssh('curl -s "http://127.0.0.1:80/api/target-split"')
    data4 = json.loads(out)
    dup = [d for d in data4 if d.get('BU') == '测试BU']
    print('  重复 POST 后测试BU记录数:', len(dup), '(预期 1, upsert 生效)')
    # DELETE
    out, err = ssh("curl -s -X DELETE http://127.0.0.1:80/api/target-split/%s" % tid)
    print('  DELETE:', out.strip(), err.strip())
    out, err = ssh('curl -s "http://127.0.0.1:80/api/target-split"')
    data5 = json.loads(out)
    print('  DELETE 后条数:', len(data5), '(预期 15)')

    print('== 6. 验证页面元素 ==')
    out, err = ssh('curl -s http://127.0.0.1:80/ | grep -o "targetBody\\|tgMetric\\|targetModalOverlay\\|tab-target\\|预算目标拆分" | sort | uniq -c')
    print(out.strip(), err.strip())

    print('== 部署完成 ==')

if __name__ == '__main__':
    main()
