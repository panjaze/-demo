/* 极简静态服务器：根 = D:/工程/自研，显式 MIME（避开 Windows 注册表污染） */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = 'D:/工程/自研';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml',
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p);
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(8931, () => console.log('serving', ROOT, 'on 8931'));
