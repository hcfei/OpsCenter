import json, urllib.request
BASE='http://60.205.204.207'

def req(url, data=None, token=None, method='GET'):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    r=urllib.request.Request(BASE+url, data=json.dumps(data).encode() if data else None, headers=headers, method=method)
    return json.loads(urllib.request.urlopen(r, timeout=10).read().decode())

tok=req('/api/auth/login', {'username':'admin','password':'Admin@123'}, method='POST')['token']

# 1. 探查 ops_forecast 数据样例
print('=== ops_forecast 样例 (2026 汇总) ===')
try:
    fc=req('/api/forecast?year=2026&bu=汇总', token=tok)
    print('预测数据条数:', len(fc) if isinstance(fc, list) else 'error')
    if fc and len(fc)>0:
        print('首条:', fc[0])
except Exception as e:
    print('Error:', e)

# 2. 探查 ops_budget 数据样例
print('\n=== ops_budget 样例 (2026 汇总) ===')
try:
    bd=req('/api/budget?year=2026&bu=汇总', token=tok)
    print('预算数据条数:', len(bd) if isinstance(bd, list) else 'error')
    if bd and len(bd)>0:
        print('首条:', bd[0])
except Exception as e:
    print('Error:', e)

# 3. 探查 ops_actual 数据样例
print('\n=== ops_actual 样例 (2026 汇总) ===')
try:
    ac=req('/api/actual?year=2026&bu=汇总', token=tok)
    print('实际数据条数:', len(ac) if isinstance(ac, list) else 'error')
    if ac and len(ac)>0:
        print('首条:', ac[0])
except Exception as e:
    print('Error:', e)

# 4. 探查组织树
print('\n=== 组织树 (预算 flow orgs) ===')
orgs=req('/api/budget-flow/orgs', token=tok)
print('组织数量:', len(orgs))
for o in orgs[:15]:
    print('  ', o.get('id'), o.get('name'), 'depth:', o.get('depth'), 'parentId:', o.get('parentId'))

# 5. 探查部门预算详情
print('\n=== 部门预算详情 (软通动力 25) ===')
try:
    d=req('/api/budget-flow/dept?year=2026&version=V1&orgId=25', token=tok)
    print('部门:', d.get('self',{}).get('name'), '周期数:', len(d.get('periods',[])))
    print('periods:', d.get('periods',[])[:5])
except Exception as e:
    print('Error:', e)

# 6. 探查预测版本
print('\n=== 预测版本列表 ===')
try:
    vers=req('/api/forecast/versions', token=tok)
    print('版本数:', len(vers) if isinstance(vers, list) else 'error')
    if vers:
        print(vers[:3])
except Exception as e:
    print('Error:', e)

print('\n=== 完成 ===')
