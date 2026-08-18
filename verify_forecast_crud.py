# -*- coding: utf-8 -*-
"""验证经营看板 API CRUD 全链路"""
import sys, json, urllib.request
import paramiko

HOST, USER, PWD = '60.205.204.207', 'root', sys.argv[1]

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)
    def run(cmd):
        _, stdout, stderr = ssh.exec_command(cmd, timeout=60)
        return stdout.read().decode('utf-8', 'replace').strip(), stderr.read().decode('utf-8', 'replace').strip()

    # 1. 新增 2027-01
    out, err = run("curl -s -X POST http://127.0.0.1/api/forecast -H 'Content-Type: application/json' -d '{\"年度\":2027,\"月份\":1,\"预测收入\":500000,\"贡献利润\":150000,\"现金流\":200000,\"费用\":80000,\"备注\":\"CRUD测试\"}'")
    print('[POST]', out, err)
    new_id = json.loads(out).get('_id')

    # 2. 更新
    out, err = run(f"curl -s -X PUT http://127.0.0.1/api/forecast/{new_id} -H 'Content-Type: application/json' -d '{{\"预测收入\":550000,\"贡献利润\":160000}}'")
    print('[PUT]', out, err)

    # 3. 查询确认
    out, err = run("curl -s 'http://127.0.0.1/api/forecast?year=2027'")
    print('[GET year=2027]', out, err)

    # 4. 删除
    out, err = run(f"curl -s -X DELETE http://127.0.0.1/api/forecast/{new_id}")
    print('[DELETE]', out, err)

    # 5. 删除后 404 校验
    out, err = run(f"curl -s -o /dev/null -w '%{{http_code}}' -X DELETE http://127.0.0.1/api/forecast/{new_id}")
    print('[DELETE again -> http]', out, err)

    # 6. 2026 数据完好
    out, err = run("curl -s 'http://127.0.0.1/api/forecast?year=2026' | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d),\"条\")'")
    print('[2026 rows]', out, err)

    ssh.close()
    print('[done]')

if __name__ == '__main__':
    main()
