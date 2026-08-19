#!/usr/bin/env python3
"""Deploy admin.html as standalone page + updated index.html"""
import sys, paramiko, time, json, urllib.request

HOST = '60.205.204.207'
USER = 'root'
PWD = sys.argv[1] if len(sys.argv) > 1 else ''
PORT = 22
REMOTE = '/opt/ops-platform/'
FILES = [
    ('运营管理平台.html', 'index.html'),
    ('admin.html', 'admin.html'),
]

def main():
    if not PWD:
        print('Usage: python deploy_admin_page.py <ssh_password>')
        sys.exit(1)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f'Connecting to {HOST}...')
    ssh.connect(HOST, port=PORT, username=USER, password=PWD, timeout=30)
    transport = ssh.get_transport()
    transport.set_keepalive(15)
    sftp = ssh.open_sftp()

    for local, remote in FILES:
        path = f'{local}'
        print(f'Uploading {local} -> {remote}...')
        sftp.put(path, REMOTE + remote)
        # verify
        st = sftp.stat(REMOTE + remote)
        print(f'  OK: {st.st_size} bytes')

    sftp.close()
    print('Files uploaded. Restarting service...')
    stdin, stdout, stderr = ssh.exec_command('systemctl restart ops-platform && sleep 1 && systemctl is-active ops-platform')
    status = stdout.read().decode().strip()
    print(f'Service status: {status}')
    if status != 'active':
        err = stderr.read().decode()
        print(f'ERROR: {err}')
        ssh.close()
        sys.exit(1)

    # Wait for service to be ready
    time.sleep(2)

    # Test: main page loads
    print('\n=== Smoke Test ===')
    try:
        req = urllib.request.Request('http://60.205.204.207/')
        resp = urllib.request.urlopen(req, timeout=10)
        html = resp.read().decode('utf-8')
        has_admin_link = 'href="/admin.html"' in html or 'href="/admin.html' in html
        print(f'Main page: {resp.status} OK, admin link present: {has_admin_link}')
    except Exception as e:
        print(f'Main page FAILED: {e}')

    # Test: admin page loads
    try:
        req = urllib.request.Request('http://60.205.204.207/admin.html')
        resp = urllib.request.urlopen(req, timeout=10)
        html = resp.read().decode('utf-8')
        has_login = 'login-overlay' in html or 'loginOverlay' in html
        has_back = 'btn-back' in html or '返回前台' in html
        print(f'Admin page: {resp.status} OK, login form: {has_login}, back button: {has_back}')
    except Exception as e:
        print(f'Admin page FAILED: {e}')

    # Test: API still works (login)
    try:
        data = json.dumps({'username': 'admin', 'password': 'Admin@123'}).encode()
        req = urllib.request.Request('http://60.205.204.207/api/auth/login',
            data=data, headers={'Content-Type': 'application/json'}, method='POST')
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read().decode())
        has_token = bool(result.get('data', {}).get('token'))
        has_admin_perm = 'system:admin' in result.get('data', {}).get('perms', [])
        print(f'Login API: {resp.status} OK, token: {has_token}, system:admin: {has_admin_perm}')
    except Exception as e:
        print(f'Login API FAILED: {e}')

    ssh.close()
    print('\nDeployment complete!')

if __name__ == '__main__':
    main()
