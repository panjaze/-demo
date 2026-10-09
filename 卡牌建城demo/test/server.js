/* 本地静态服务器：正确的 CSS MIME（绕开 Windows 注册表污染 python mimetypes 的问题） */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/工程/自研/卡牌建城demo';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(path.join(ROOT, p));
  if (!file.toLowerCase().startsWith(path.resolve(ROOT).toLowerCase())) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8124, '127.0.0.1', () => console.log('serving on http://127.0.0.1:8124'));
