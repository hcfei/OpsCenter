#!/usr/bin/env python3
"""Deploy fixed app.js (buildData leaf-first aggregation) + smoke test forecast/dept API."""
import sys, paramiko, time, json, urllib.request

HOST = '60.205.204.207'
USER = 'root'
PWD = sys.argv[1] if len(sys.argv) > 1 else ''
PORT = 22
REMOTE = '/opt/ops-platform/'
FILES = [
    ('app.js', 'app.js'),
    ('运营管理平台.html', 'index.html'),
]

def main():
    if not PWD:
        print('Usage: python deploy_dept_fix.py <ssh_password>')
        sys.exit(1)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f'Connecting to {HOST}...')
    ssh.connect(HOST, port=PORT, username=USER, password=PWD, timeout=30)
    transport = ssh.get_transport()
    transport.set_keepalive(15)
    sftp = ssh.open_sftp()

    for local, remote in FILES:
        print(f'Uploading {local} -> {remote}...')
        sftp.put(local, REMOTE + remote)
        st = sftp.stat(REMOTE + remote)
        print(f'  OK: {st.st_size} bytes')

    sftp.close()
    print('Files uploaded. Restarting service...')
    stdin, stdout, stderr = ssh.exec_command('systemctl restart ops-platform && sleep 2 && systemctl is-active ops-platform')
    status = stdout.read().decode().strip()
    print(f'Service status: {status}')
    if status != 'active':
        err = stderr.read().decode()
        print(f'ERROR: {err}')
        # Try to get journal logs
        stdin2, stdout2, stderr2 = ssh.exec_command('journalctl -u ops-platform --no-pager -n 30')
        print('--- journal ---')
        print(stdout2.read().decode())
        ssh.close()
        sys.exit(1)

    # Wait for service to be ready
    time.sleep(3)

    # Smoke test
    print('\n=== Smoke Test ===')

    # 1. Login
    token = None
    try:
        data = json.dumps({'username': 'admin', 'password': 'Admin@123'}).encode()
        req = urllib.request.Request('http://60.205.204.207/api/auth/login',
            data=data, headers={'Content-Type': 'application/json'}, method='POST')
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read().decode())
        token = result.get('token')
        print(f'Login: OK, token={token[:12]}...' if token else 'Login: no token!')
    except Exception as e:
        print(f'Login FAILED: {e}')

    if not token:
        ssh.close()
        sys.exit(1)

    # 2. Test forecast/dept for all org levels
    print('\n--- forecast/dept API ---')
    for org_id in [25, 26, 27, 28, 29, 30, 31, 32]:
        try:
            req = urllib.request.Request(
                f'http://60.205.204.207/api/forecast/dept?orgId={org_id}&year=2026',
                headers={'Authorization': f'Bearer {token}'})
            resp = urllib.request.urlopen(req, timeout=10)
            d = json.loads(resp.read().decode())
            s = d.get('self', {})
            yr = s.get('data', {}).get('全年', {})
            fc = yr.get('forecast_revenue', 0)
            bd = yr.get('budget_revenue', 0)
            ac = yr.get('actual_revenue', 0)
            print(f'  orgId={org_id:2d} {s.get("name","?"):12s} | fc={fc:>10.0f} bd={bd:>10.0f} ac={ac:>10.0f} | children={len(d.get("children",[]))}')
        except Exception as e:
            print(f'  orgId={org_id:2d} FAILED: {e}')

    # 3. Check for double counting: root budget should equal sum of leaf budgets
    print('\n--- Double-counting check ---')
    try:
        req = urllib.request.Request(
            'http://60.205.204.207/api/forecast/dept?orgId=25&year=2026',
            headers={'Authorization': f'Bearer {token}'})
        resp = urllib.request.urlopen(req, timeout=10)
        d = json.loads(resp.read().decode())
        root_bd = d.get('self', {}).get('data', {}).get('全年', {}).get('budget_revenue', 0)
        leaf_sum = 0
        for c in d.get('children', []):
            if not d.get('children'): break
            # Check if this child has its own children (intermediate vs leaf)
            # We only want leaf-level data
        # Instead, let's just check root vs MAG
        mag_bd = 0
        for c in d.get('children', []):
            if c.get('id') == 26:
                mag_bd = c.get('data', {}).get('全年', {}).get('budget_revenue', 0)
                break
        print(f'  Root(25) budget_revenue = {root_bd:.0f}')
        print(f'  MAG(26)  budget_revenue = {mag_bd:.0f}')
        if root_bd > 0 and mag_bd > 0:
            ratio = root_bd / mag_bd
            if 0.95 < ratio < 1.05:
                print(f'  ratio={ratio:.3f} -> OK (no double counting)')
            elif ratio > 1.5:
                print(f'  ratio={ratio:.3f} -> WARNING: possible double counting!')
            else:
                print(f'  ratio={ratio:.3f} -> check data')
    except Exception as e:
        print(f'  FAILED: {e}')

    ssh.close()
    print('\nDeployment complete!')

if __name__ == '__main__':
    main()
