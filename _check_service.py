import paramiko, sys
HOST='60.205.204.207'
USER='root'
PWD=sys.argv[1] if len(sys.argv)>1 else ''
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=22, username=USER, password=PWD, timeout=30)
stdin, stdout, stderr = ssh.exec_command('systemctl status ops-platform')
print(stdout.read().decode())
print(stderr.read().decode())
stdin, stdout, stderr = ssh.exec_command('journalctl -u ops-platform -n 20 --no-pager')
print('=== journal ===')
print(stdout.read().decode())
ssh.close()
