#!/usr/bin/env python3
"""Deploy modular backend to production server"""
import sys, paramiko, time, json, urllib.request, os

HOST = '60.205.204.207'
USER = 'root'
PWD = sys.argv[1] if len(sys.argv) > 1 else ''
PORT = 22
REMOTE_DIR = '/opt/ops-platform'

# Files to deploy (relative to backend/)
DEPLOY_FILES = [
    ('backend/app.js', 'app.js'),
    ('backend/routes/forecast.js', 'routes/forecast.js'),
    ('backend/routes/budget.js', 'routes/budget.js'),
    ('backend/routes/actual.js', 'routes/actual.js'),
    ('backend/routes/records.js', 'routes/records.js'),
    ('backend/routes/rbac.js', 'routes/rbac.js'),
    ('backend/routes/auth.js', 'routes/auth.js'),
    ('backend/routes/table_meta.js', 'routes/table_meta.js'),
    ('backend/routes/target_split.js', 'routes/target_split.js'),
    ('backend/routes/dashboard.js', 'routes/dashboard.js'),
    ('backend/db/pool.js', 'db/pool.js'),
    ('backend/db/migrations.js', 'db/migrations.js'),
    ('backend/utils/auth.js', 'utils/auth.js'),
    ('backend/utils/sql_helpers.js', 'utils/sql_helpers.js'),
]

def main():
    if not PWD:
        print('Usage: python deploy_backend.py <ssh_password>')
        sys.exit(1)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f'Connecting to {HOST}...')
    ssh.connect(HOST, port=PORT, username=USER, password=PWD, timeout=30)
    transport = ssh.get_transport()
    transport.set_keepalive(15)
    sftp = ssh.open_sftp()

    # Create remote directories
    ssh.exec_command(f'mkdir -p {REMOTE_DIR}/routes {REMOTE_DIR}/db {REMOTE_DIR}/utils')

    # Upload files
    for local_path, remote_path in DEPLOY_FILES:
        full_remote = f'{REMOTE_DIR}/{remote_path}'
        print(f'Uploading {local_path} -> {remote_path}...')
        try:
            sftp.put(local_path, full_remote)
            st = sftp.stat(full_remote)
            print(f'  OK: {st.st_size} bytes')
        except FileNotFoundError:
            print(f'  SKIP: {local_path} not found')

    sftp.close()
    print('\nFiles uploaded. Restarting service...')

    # Restart service
    stdin, stdout, stderr = ssh.exec_command('systemctl restart ops-platform && sleep 2 && systemctl is-active ops-platform')
    status = stdout.read().decode().strip()
    print(f'Service status: {status}')

    if status != 'active':
        err = stderr.read().decode()
        print(f'ERROR: {err}')
        ssh.close()
        sys.exit(1)

    # Smoke test
    print('\n=== Smoke Test ===')
    try:
        data = json.dumps({'username': 'admin', 'password': 'Admin@123'}).encode()
        req = urllib.request.Request('http://60.205.204.207/api/auth/login',
            data=data, headers={'Content-Type': 'application/json'}, method='POST')
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read().decode())
        token = result.get('token')
        print(f'Login: OK, token={token[:12]}...' if token else 'Login: no token!')

        # Test forecast API
        if token:
            req = urllib.request.Request(f'http://60.205.204.207/api/forecast/dept?orgId=25&year=2026',
                headers={'Authorization': f'Bearer {token}'})
            resp = urllib.request.urlopen(req, timeout=10)
            d = json.loads(resp.read().decode())
            s = d.get('self', {})
            yr = s.get('data', {}).get('全年', {})
            print(f'forecast/dept: orgId=25, fc_rev={yr.get("forecast_revenue",0):.0f}, bd_rev={yr.get("budget_revenue",0):.0f}')
    except Exception as e:
        print(f'Smoke test FAILED: {e}')

    ssh.close()
    print('\nDeployment complete!')

if __name__ == '__main__':
    main()
