# -*- coding: utf-8 -*-
"""部署 RBAC 版本(登录 + 后台管理): 上传 app.js + 运营管理平台.html → 同步 index.html → 重启服务
→ 抓启动日志确认 sys_user/sys_role/sys_perm/sys_org 种子
→ 接口冒烟: 401 守卫 / login / me / users CRUD / roles CRUD / perms / orgs / 非 admin 403
→ 测试数据(前缀 smk_)全部清理
→ 公网验证
用法: python deploy_rbac.py <服务器root密码>
"""
import sys, json, urllib.request, urllib.error, time
import paramiko

HOST, USER, PWD = '60.205.204.207', 'root', sys.argv[1]
BASE = 'C:/Users/hcfei/WorkBuddy/2026-08-18-11-37-38/standalone'
REMOTE = '/opt/ops-platform'
BASE_URL = 'http://60.205.204.207'

PASS = 0
FAIL = 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond: PASS += 1; print('PASS | ' + name + ((' | ' + str(detail)) if detail else ''))
    else: FAIL += 1; print('FAIL | ' + name + ((' | ' + str(detail)) if detail else ''))

def http(method, path, body=None, token=None, raw=False):
    """返回 (status, data) ; raw=True 时不解析 JSON"""
    req = urllib.request.Request(BASE_URL + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    data = json.dumps(body).encode('utf-8') if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=15) as r:
            txt = r.read().decode('utf-8', 'replace')
            return r.status, (txt if raw else json.loads(txt))
    except urllib.error.HTTPError as e:
        txt = e.read().decode('utf-8', 'replace')
        try: return e.code, json.loads(txt)
        except Exception: return e.code, txt

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)
    sftp = ssh.open_sftp()

    for local, remote in [('app.js', 'app.js'), ('运营管理平台.html', '运营管理平台.html')]:
        sftp.put(f'{BASE}/{local}', f'{REMOTE}/{remote}')
        print(f'[upload] {local} -> {REMOTE}/{remote} ({sftp.stat(f"{REMOTE}/{remote}").st_size} bytes)')

    def run(cmd):
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
        return stdout.read().decode('utf-8', 'replace').strip(), stderr.read().decode('utf-8', 'replace').strip()

    out, err = run(f'cd {REMOTE} && cp 运营管理平台.html index.html && ls -la index.html app.js 运营管理平台.html')
    print('[sync]', out or err)

    out, err = run('systemctl restart ops-platform && sleep 4 && systemctl is-active ops-platform')
    print('[service]', out or err)
    out, err = run(f'journalctl -u ops-platform -n 40 --no-pager | grep -E "sys_user|sys_role|sys_perm|sys_org|管理员|init"')
    print('[启动日志]', (out or err)[:800])

    print('\n===== 接口冒烟测试(公网) =====')

    # 1. 未登录守卫
    st, d = http('GET', '/api/records')
    check('无 token 访问业务接口 → 401', st == 401, st)
    st, d = http('GET', '/api/admin/users')
    check('无 token 访问后台管理 → 401', st == 401, st)
    st, d = http('GET', '/api/auth/me')
    check('无 token 访问 /api/auth/me → 401', st == 401, st)

    # 2. 登录
    st, d = http('POST', '/api/auth/login', {'username': 'admin', 'password': 'Admin@123'})
    check('admin 登录成功 → 200 + token', st == 200 and bool(d.get('token')), st if st != 200 else '')
    check('admin 登录返回 perms 含 system:admin', 'system:admin' in (d.get('perms') or []), d.get('perms'))
    check('admin 登录返回 roles 含 admin', 'admin' in (d.get('roles') or []), d.get('roles'))
    TOKEN = d.get('token', '')

    st, d = http('POST', '/api/auth/login', {'username': 'admin', 'password': 'Wrong@123'})
    check('错误密码登录 → 401', st == 401, st)

    st, d = http('GET', '/api/auth/me', token=TOKEN)
    check('me 校验会话 → 200 + user', st == 200 and d.get('user', {}).get('username') == 'admin', st if st != 200 else '')

    # 3. 基础列表
    st, d = http('GET', '/api/admin/users?page=1&size=10', token=TOKEN)
    check('用户列表分页 → 200 + total>=1', st == 200 and d.get('total', 0) >= 1, d.get('total'))
    st, d = http('GET', '/api/admin/roles', token=TOKEN)
    names = [r['code'] for r in d] if isinstance(d, list) else []
    admin_rid = next((r['id'] for r in d if r.get('code') == 'admin'), None) if isinstance(d, list) else None
    check('角色列表 → 含 admin/user 内置角色', 'admin' in names and 'user' in names, names)
    check('定位 admin 角色 id', admin_rid is not None, admin_rid)
    st, d = http('GET', '/api/admin/permissions', token=TOKEN)
    codes = [p['code'] for p in d] if isinstance(d, list) else []
    check('权限树 → 9 项含 system:admin/forecast:write', len(codes) == 9 and 'system:admin' in codes and 'forecast:write' in codes, codes)
    st, d = http('GET', '/api/admin/orgs', token=TOKEN)
    orgNames = []
    def collect_names(nodes):
        for n in nodes or []:
            orgNames.append(n['name'])
            collect_names(n.get('children') or [])
    collect_names(d.get('tree', []))
    check('组织树 → 含 运营管理平台/经营管理部', '运营管理平台' in orgNames and '经营管理部' in orgNames, orgNames)

    # 4. 用户 CRUD (smk_ 前缀, 最后清理) —— 注意所有请求都要带 token
    st, d = http('POST', '/api/admin/users', {'username': 'smk_user', 'password': 'Smk@123456', 'realName': '冒烟测试', 'roleIds': []}, token=TOKEN)
    check('创建用户 → 201', st == 201, st if st != 201 else d)
    st, d = http('POST', '/api/admin/users', {'username': 'smk_user', 'password': 'x' * 8}, token=TOKEN)
    check('重复用户名创建 → 400', st == 400, st)
    st, d = http('POST', '/api/admin/users', {'username': 'bad name!', 'password': 'x' * 8}, token=TOKEN)
    check('非法用户名创建 → 400', st == 400, st)
    st, d = http('GET', '/api/admin/users?keyword=smk_user', token=TOKEN)
    uid = d['list'][0]['id'] if st == 200 and d.get('list') else None
    check('按关键字搜索 smk_user → 命中', st == 200 and len(d.get('list', [])) == 1, d.get('total'))
    st, d = http('PUT', f'/api/admin/users/{uid}', {'realName': '冒烟测试-改'}, token=TOKEN)
    check('编辑用户 → 200', st == 200, st)
    st, d = http('PUT', f'/api/admin/users/{uid}/password', {'password': 'New@123456'}, token=TOKEN)
    check('重置密码 → 200', st == 200, st)
    st, d = http('PUT', f'/api/admin/users/{uid}/status', {'status': 0}, token=TOKEN)
    check('禁用用户 → 200', st == 200, st)
    st, d = http('POST', '/api/auth/login', {'username': 'smk_user', 'password': 'New@123456'})
    check('禁用用户登录 → 401', st == 401, st)
    st, d = http('PUT', f'/api/admin/users/{uid}/status', {'status': 1}, token=TOKEN)
    check('启用用户 → 200', st == 200, st)
    st, d = http('PUT', f'/api/admin/users/{uid}/roles', {'roleIds': []}, token=TOKEN)
    check('用户角色接口 → 200', st == 200, st)

    # 5. 角色 CRUD (注意: GET /api/admin/roles 不支持 keyword, 必须从 POST 响应取 _id)
    st, d = http('POST', '/api/admin/roles', {'name': '冒烟角色', 'code': 'smk_role', 'description': '冒烟', 'status': 1}, token=TOKEN)
    check('创建角色 → 201 且返回 _id', st == 201 and bool(d.get('_id')), d if st != 201 else '')
    rid = int(d['_id']) if st == 201 and d.get('_id') else None
    check('创建角色返回有效 _id', rid is not None and rid > 0, rid)
    st, d = http('PUT', f'/api/admin/roles/{rid}', {'name': '冒烟角色2', 'code': 'smk_role', 'status': 1}, token=TOKEN)
    check('编辑角色 → 200', st == 200, st)
    st, d = http('PUT', f'/api/admin/roles/{rid}/permissions', {'permIds': [1, 2]}, token=TOKEN)
    check('角色绑定权限 → 200', st == 200, st)
    st, d = http('GET', f'/api/admin/roles/{rid}/permissions', token=TOKEN)
    check('角色权限查询 → permIds 含 1/2', st == 200 and set(d.get('permIds', [])) >= {1, 2}, d)
    st, d = http('PUT', f'/api/admin/roles/{rid}/users', {'userIds': [uid]}, token=TOKEN)
    check('角色分配用户 → 200', st == 200, st)
    st, d = http('GET', f'/api/admin/roles/{rid}/users', token=TOKEN)
    check('角色用户查询 → 含 smk_user', st == 200 and any(u['id'] == uid for u in (d if isinstance(d, list) else [])), d)

    # 6. 权限 CRUD
    st, d = http('POST', '/api/admin/permissions', {'name': '冒烟权限', 'code': 'smk:view', 'type': 'button', 'sort': 99, 'parentId': None}, token=TOKEN)
    check('创建权限 → 201', st == 201, st if st != 201 else d)
    st, d = http('GET', '/api/admin/permissions', token=TOKEN)
    check('权限树含 smk:view', any(p['code'] == 'smk:view' for p in d if isinstance(d, list)), '')
    pid = next((p['id'] for p in d if p['code'] == 'smk:view'), None) if isinstance(d, list) else None
    st, d = http('PUT', f'/api/admin/permissions/{pid}', {'name': '冒烟权限改', 'code': 'smk:view', 'type': 'button', 'sort': 99}, token=TOKEN)
    check('编辑权限 → 200', st == 200, st)

    # 7. 组织 CRUD
    st, d = http('POST', '/api/admin/orgs', {'name': '冒烟组织', 'type': 'dept', 'parentId': None, 'sort': 99}, token=TOKEN)
    check('创建组织 → 201', st == 201, st if st != 201 else d)
    st, d = http('GET', '/api/admin/orgs', token=TOKEN)
    def find_org(nodes, name):
        for n in nodes or []:
            if n.get('name') == name:
                return n.get('id')
            r = find_org(n.get('children') or [], name)
            if r: return r
        return None
    oid = find_org(d.get('tree', []), '冒烟组织')
    check('组织树含 冒烟组织', oid is not None, '')
    st, d = http('PUT', f'/api/admin/orgs/{oid}', {'name': '冒烟组织改', 'type': 'dept', 'sort': 99}, token=TOKEN)
    check('编辑组织 → 200', st == 200, st)

    # 8. 非 admin 权限验证: 用 smk_user 登录
    st, d = http('POST', '/api/auth/login', {'username': 'smk_user', 'password': 'New@123456'})
    check('smk_user 登录成功(重置密码后)', st == 200 and bool(d.get('token')), st)
    UTOKEN = d.get('token', '')
    st, d = http('GET', '/api/admin/users', token=UTOKEN)
    check('非 admin 访问后台管理 → 403', st == 403, st)
    st, d = http('GET', '/api/auth/me', token=UTOKEN)
    check('非 admin me → 200 且 perms 无 system:admin', st == 200 and 'system:admin' not in (d.get('perms') or []), d.get('perms'))
    st, d = http('POST', '/api/auth/logout', {}, token=UTOKEN)
    check('smk_user 登出 → 200', st == 200, st)
    st, d = http('GET', '/api/auth/me', token=UTOKEN)
    check('登出后 token 失效 → 401', st == 401, st)

    # ===== 清理测试数据 =====
    print('\n===== 清理测试数据 =====')
    if uid:
        st, d = http('DELETE', f'/api/admin/users/{uid}', token=TOKEN)
        print(f'[clean] DELETE user {uid} -> {st}')
    if rid:
        st, d = http('DELETE', f'/api/admin/roles/{rid}', token=TOKEN)
        print(f'[clean] DELETE role {rid} -> {st}')
    if pid:
        st, d = http('DELETE', f'/api/admin/permissions/{pid}', token=TOKEN)
        print(f'[clean] DELETE perm {pid} -> {st}')
    if oid:
        st, d = http('DELETE', f'/api/admin/orgs/{oid}', token=TOKEN)
        print(f'[clean] DELETE org {oid} -> {st}')

    # 清理后复查
    st, d = http('GET', '/api/admin/users?keyword=smk_user', token=TOKEN)
    check('清理后无 smk_user 残留', st == 200 and d.get('total', 0) == 0, d.get('total'))
    st, d = http('GET', '/api/admin/roles', token=TOKEN)
    roleCodes = [r['code'] for r in d] if isinstance(d, list) else []
    check('清理后无 smk_role 残留', st == 200 and 'smk_role' not in roleCodes, roleCodes)
    st, d = http('GET', '/api/admin/permissions', token=TOKEN)
    check('清理后权限树恢复 9 项', st == 200 and len(d) == 9, len(d) if isinstance(d, list) else d)

    # 复查 admin 角色权限完整性 (防止冒烟误伤)
    st, d = http('GET', f'/api/admin/roles/{admin_rid}/permissions', token=TOKEN)
    check(f'admin 角色(id={admin_rid})权限完整 9 项', st == 200 and len(d.get('permIds', [])) == 9, d.get('permIds'))

    # admin 登出
    http('POST', '/api/auth/logout', {}, token=TOKEN)

    # 9. 公网首页验证
    try:
        with urllib.request.urlopen(BASE_URL + '/', timeout=10) as r:
            html = r.read().decode('utf-8', 'replace')
            check('首页含登录页 loginOverlay', 'loginOverlay' in html and 'loginUsername' in html)
            check('首页含后台管理 JS (amInit)', 'amInit' in html)
    except Exception as e:
        check('首页访问', False, str(e))

    sftp.close()
    ssh.close()
    print(f'\n===== 冒烟结果: {PASS} PASS / {FAIL} FAIL =====')
    sys.exit(1 if FAIL else 0)

if __name__ == '__main__':
    main()
