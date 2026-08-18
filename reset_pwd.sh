#!/bin/bash
# 临时免密模式重置 MySQL root/ops_app 密码 (在服务器本地执行)
echo "=== 1. 停止 mysqld ==="
systemctl stop mysqld 2>&1
sleep 2

echo "=== 2. 启动临时实例 (skip-grant-tables, 仅本机 socket) ==="
rm -f /tmp/mysql_reset.log
nohup mysqld --user=mysql --skip-grant-tables --skip-networking >/tmp/mysql_reset.log 2>&1 &
OK=0
for i in $(seq 1 30); do
  if mysql -uroot -N -e "SELECT 'conn_ok';" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
if [ "$OK" != "1" ]; then
  echo "临时实例启动失败, 日志:"
  tail -30 /tmp/mysql_reset.log
  pgrep -af mysqld || echo "(无 mysqld 进程)"
  exit 1
fi
echo "临时实例已就绪"

echo "=== 3. 免密查询用户列表 ==="
mysql -uroot -N -e "SELECT user, host FROM mysql.user WHERE user IN ('root','ops_app');" 2>&1

echo "=== 4. 生成 ALTER 语句 ==="
mysql -uroot -N -e "SELECT CONCAT(\"ALTER USER '\", user, \"'@'\", host, \"' IDENTIFIED BY '\", IF(user='root','root','ops_app'), \"';\" ) FROM mysql.user WHERE user IN ('root','ops_app');" > /tmp/alter_users.sql 2>&1
cat /tmp/alter_users.sql
{ echo "FLUSH PRIVILEGES;"; cat /tmp/alter_users.sql; echo "FLUSH PRIVILEGES;"; } > /tmp/alter_full.sql

echo "=== 5. 同连接执行 FLUSH + ALTER ==="
mysql -uroot < /tmp/alter_full.sql 2>&1

echo "=== 6. 停止临时实例 ==="
pkill -f "skip-grant-tables" 2>&1
for i in $(seq 1 20); do
  pgrep -f "skip-grant-tables" >/dev/null 2>&1 || break
  sleep 1
done

echo "=== 7. 正常启动 mysqld ==="
systemctl start mysqld 2>&1
sleep 3
systemctl is-active mysqld

echo "=== 8. 验证新密码 ==="
mysql -uroot -proot -e "SELECT VERSION() AS v;" 2>&1
mysql -uops_app -pops_app -h127.0.0.1 ops_platform -e "SELECT COUNT(*) AS cnt FROM ops_records;" 2>&1

echo "=== DONE ==="
