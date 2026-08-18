# -*- coding: utf-8 -*-
"""
用《预测结果模板.xlsx》预算目标拆分 Sheet 的「汇总」行真实数据，
覆盖经营看板的月度预测(ops_forecast)与月度预算(ops_budget)。
映射规则：
  预测(实际值) ← 模板「实际值（7月）」汇总行
  预算(目标值) ← 模板「2026年目标-V1」汇总行
  季度 → 月度：m1=Q/3, m2=Q/3, m3=Q-m1-m2（保证季度合计精确等于模板）
  费用：模板无此指标，置 0
"""
import json, urllib.request

BASE = 'http://60.205.204.207'

# 模板「汇总」行（来自 SEED_TARGET，与 xlsx 一致）
HUIZONG = {
    '收入':   {'act': [63937.160870, 61526.336134, 64534.736835, 60821.018791],
               'tgt': [63937.160870, 61526.336134, 64660.729595, 60695.026031]},
    '贡献利润': {'act': [3982.353194, 5771.658671, 5705.141044, 4945.327633],
               'tgt': [3982.353194, 5771.658671, 6672.754611, 5477.714107]},
    '现金流':  {'act': [-8722.110478, 19083.625467, -2207.543092, 17389.198177],
               'tgt': [-8722.110478, 19083.625467, -4705.186912, 13376.004010]},
}
Q_NOTE = ['Q1（1-3月）', 'Q2（4-6月）', 'Q3（7-9月）', 'Q4（10-12月）']

def split_q(q):
    """季度均摊到3个月，第三个月补差保证合计精确"""
    m1 = round(q / 3, 6)
    m2 = round(q / 3, 6)
    m3 = round(q - m1 - m2, 6)
    return m1, m2, m3

# 生成 12 个月预测记录（实际值）
forecast = []
for qi in range(4):  # Q1-Q4
    m1, m2, m3 = 1+qi*3, 2+qi*3, 3+qi*3
    rev = split_q(HUIZONG['收入']['act'][qi])
    prof = split_q(HUIZONG['贡献利润']['act'][qi])
    cash = split_q(HUIZONG['现金流']['act'][qi])
    for j, m in enumerate([m1, m2, m3]):
        forecast.append({
            '年度': 2026, '月份': m,
            '预测收入': rev[j], '贡献利润': prof[j], '现金流': cash[j],
            '费用': 0, '备注': '模板汇总行实际值·' + Q_NOTE[qi]
        })

# 生成 12 个月预算记录（目标值）
budget = []
for qi in range(4):
    m1, m2, m3 = 1+qi*3, 2+qi*3, 3+qi*3
    rev = split_q(HUIZONG['收入']['tgt'][qi])
    prof = split_q(HUIZONG['贡献利润']['tgt'][qi])
    cash = split_q(HUIZONG['现金流']['tgt'][qi])
    for j, m in enumerate([m1, m2, m3]):
        budget.append({
            '年度': 2026, '月份': m,
            '预算收入': rev[j], '预算贡献利润': prof[j],
            '预算现金流': cash[j], '预算费用': 0
        })

print('=== 生成的预测记录(前3条) ===')
for r in forecast[:3]: print(r)
print('=== 生成的预算记录(前3条) ===')
for r in budget[:3]: print(r)

def api(path, method, data=None):
    url = BASE + path
    body = json.dumps(data).encode('utf-8') if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))

# 1. 覆盖预测：逐条 POST（year+month upsert）
print('\n=== 写入预测 ===')
for r in forecast:
    st, res = api('/api/forecast', 'POST', r)
    if st != 201:
        print('FAIL 预测', r['月份'], st, res); raise SystemExit(1)
print('预测写入完成: 12 条')

# 2. 覆盖预算：batch（DELETE+INSERT 当年）
print('\n=== 写入预算 ===')
st, res = api('/api/budget/batch', 'POST', budget)
print('预算 batch:', st, res)

# 3. 验证：读取并校验季度合计
print('\n=== 验证 ===')
st, fc_list = api('/api/forecast?year=2026', 'GET')
st, bg_list = api('/api/budget?year=2026', 'GET')
print('forecast 条数:', len(fc_list), '| budget 条数:', len(bg_list))

def qsum(records, field, qidx):
    months = [1+qidx*3, 2+qidx*3, 3+qidx*3]
    return round(sum(r[field] for r in records if r['月份'] in months), 6)

print('\n季度合计校验 (预测=实际值, 预算=目标值):')
ok = True
for metric, ffield, bfield in [('收入','预测收入','预算收入'), ('贡献利润','贡献利润','预算贡献利润'), ('现金流','现金流','预算现金流')]:
    for qi in range(4):
        fa = qsum(fc_list, ffield, qi)
        ta = qsum(bg_list, bfield, qi)
        exp_a = HUIZONG[metric]['act'][qi]
        exp_t = HUIZONG[metric]['tgt'][qi]
        aok = abs(fa - exp_a) < 0.01
        tok = abs(ta - exp_t) < 0.01
        ok = ok and aok and tok
        print(f'  {metric} Q{qi+1}: 预测合计={fa} (期望{exp_a} {"✓" if aok else "✗"}) | 预算合计={ta} (期望{exp_t} {"✓" if tok else "✗"})')

# YTD 校验
def ytd(records, field):
    return round(sum(r[field] for r in records), 6)
print('\nYTD 校验:')
for metric, ffield, bfield in [('收入','预测收入','预算收入'), ('贡献利润','贡献利润','预算贡献利润'), ('现金流','现金流','预算现金流')]:
    fy = ytd(fc_list, ffield); ty = ytd(bg_list, bfield)
    print(f'  {metric}: 预测YTD={fy} (期望{sum(HUIZONG[metric]["act"])}) | 预算YTD={ty} (期望{sum(HUIZONG[metric]["tgt"])})')

print('\n=== 结果:', '全部校验通过 ✓' if ok else '存在偏差 ✗', '===')

# 保存生成数据供更新 SEED 用
with open(r'C:\Users\hcfei\WorkBuddy\2026-08-18-11-37-38\standalone\_real_fc_budget.json', 'w', encoding='utf-8') as f:
    json.dump({'forecast': forecast, 'budget': budget}, f, ensure_ascii=False, indent=2)
print('已保存 _real_fc_budget.json')
