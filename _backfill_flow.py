# -*- coding: utf-8 -*-
"""把《预测结果模板.xlsx》预算目标拆分 Sheet 的目标值，回填到 ops_budget_flow（部门×周期预算表）。
映射: Excel 4 个 BU -> 组织树 4 个 BU 叶子节点:
  消费者软工(29)=软工, 消费者硬工(30)=硬工, 消费者云(31)=云, 智能汽车解决方案(32)=智能汽车
父节点(终端与车28=4BU之和 / ICTT27=28 / MAG26=27 / 软通动力25=26) 按子节点汇总。
周期: 1月-12月(季度目标÷3) + Q1-Q4 + H1/H2 + 全年。
并发写入 8 节点 × 19 周期 = 152 条 (幂等 ON DUPLICATE KEY UPDATE)。
"""
import json, urllib.request, urllib.error, openpyxl
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

BASE = 'http://60.205.204.207'
XLSX = r'D:\工作\03. 领域运营\02.运营预测\预测结果模板.xlsx'
YEAR, VERSION = 2026, 'V1'
MAP = {'收入': 'budget_revenue', '贡献利润': 'budget_profit', '现金流': 'budget_cash'}
PERIODS = [f'{m}月' for m in range(1, 13)] + ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', '全年']
EXCEL_BU = {'软工': 29, '硬工': 30, '云': 31, '智能汽车': 32}
TREE = {25: [26], 26: [27], 27: [28], 28: [29, 30, 31, 32], 29: [], 30: [], 31: [], 32: []}

def req(url, data=None, method='GET', token=None):
    h = {'Content-Type': 'application/json'}
    if token: h['Authorization'] = 'Bearer ' + token
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

st, d = req(BASE + '/api/auth/login', {'username': 'admin', 'password': 'Admin@123'}, 'POST')
token = d.get('token')
print('login', st)

# 读 Excel 目标值
wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb['预算目标拆分']
rows = [r for r in ws.iter_rows(values_only=True) if not all(c is None for c in r)]
ts = {}
cur = None
for r in rows[2:]:
    if r[0] in MAP: cur = r[0]
    bu = r[1]
    if cur not in MAP or bu not in EXCEL_BU: continue
    ts[(cur, bu)] = {1: r[9], 2: r[10], 3: r[11], 4: r[12]}

def compute_leaf(qv):
    res = {}
    for m in range(1, 13):
        k = (m - 1) // 3 + 1
        res[f'{m}月'] = round((qv.get(k) or 0) / 3.0, 2)
    res['Q1'] = round(qv.get(1) or 0, 2); res['Q2'] = round(qv.get(2) or 0, 2)
    res['Q3'] = round(qv.get(3) or 0, 2); res['Q4'] = round(qv.get(4) or 0, 2)
    res['H1'] = round((qv.get(1) or 0) + (qv.get(2) or 0), 2)
    res['H2'] = round((qv.get(3) or 0) + (qv.get(4) or 0), 2)
    res['全年'] = round(sum((qv.get(i) or 0) for i in (1, 2, 3, 4)), 2)
    return res

values = {}
for bu_excel, oid in EXCEL_BU.items():
    values[oid] = {metric: compute_leaf(ts[(metric, bu_excel)]) for metric in MAP}
for oid in [28, 27, 26, 25]:
    children = TREE[oid]
    values[oid] = {metric: {p: round(sum(values[c][metric][p] for c in children), 2) for p in PERIODS} for metric in MAP}

# 构造并发生 POST 任务
tasks = []
for oid in [25, 26, 27, 28, 29, 30, 31, 32]:
    for p in PERIODS:
        rec = {'year': YEAR, 'version': VERSION, 'period': p, 'orgId': oid,
               'budget_revenue': values[oid]['收入'][p], 'budget_profit': values[oid]['贡献利润'][p],
               'budget_cash': values[oid]['现金流'][p], 'remark': '预测结果模板回填', 'source': 'backfill'}
        tasks.append(rec)

def post_one(rec):
    return req(BASE + '/api/budget-flow', data=rec, method='POST', token=token)

print('写入任务数:', len(tasks))
ok = err = 0
with ThreadPoolExecutor(max_workers=16) as ex:
    for stt, resp in ex.map(post_one, tasks):
        if stt == 200: ok += 1
        else:
            err += 1
            if err <= 5: print('  ERR', stt, resp)
print(f'写入完成: 成功 {ok} / 失败 {err}')

# 验证: 根节点全年 + 各 BU 全年
st, tree = req(BASE + '/api/budget-flow/tree?year=2026&version=V1', token=token)
print('\n验证 tree: totalRevenue=', tree.get('totalRevenue'), 'totalProfit=', tree.get('totalProfit'), 'totalCash=', tree.get('totalCash'))
print('根(软通动力) 全年: 收入=', values[25]['收入']['全年'], '利润=', values[25]['贡献利润']['全年'], '现金流=', values[25]['现金流']['全年'])
for oid in [29, 30, 31, 32]:
    print(f'  BU节点{oid} 全年: 收入=', values[oid]['收入']['全年'], '利润=', values[oid]['贡献利润']['全年'], '现金流=', values[oid]['现金流']['全年'])
