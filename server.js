/**
 * 运营管理平台 - 轻量静态文件服务器
 * 用法: node server.js [端口号]
 * 默认端口: 8080
 * 无需安装任何依赖, 使用 Node.js 内置 http 模块
 */

var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = parseInt(process.argv[2]) || 8080;
var ROOT_DIR = __dirname;

var MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.eot':  'application/vnd.ms-fontobject',
  '.map':  'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.pdf':  'application/pdf'
};

var server = http.createServer(function(req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '') url = '/运营管理平台.html';

  var filePath = path.join(ROOT_DIR, url);

  // 安全检查: 防止路径遍历
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, function(err, data) {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 Not Found</h1><p>文件不存在: ' + url + '</p>');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error: ' + err.message);
      }
      return;
    }

    var ext = path.extname(filePath).toLowerCase();
    var contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, function() {
  console.log('');
  console.log('========================================');
  console.log('  运营管理平台已启动');
  console.log('========================================');
  console.log('');
  console.log('  本地访问:  http://localhost:' + PORT);
  console.log('  局域网访问: http://' + getLocalIP() + ':' + PORT);
  console.log('');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});

function getLocalIP() {
  var os = require('os');
  var interfaces = os.networkInterfaces();
  for (var name in interfaces) {
    for (var i = 0; i < interfaces[name].length; i++) {
      var addr = interfaces[name][i];
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}
