// 溯源 · Render 单服务部署
// 一个零依赖的 Node 服务器：
//   - 把 index.html（以及同目录静态文件）发给访问者
//   - 在 /api/generate 上接住"实时生成"请求，替前端转发给 DeepSeek
//
// 只用 Node 自带模块，无需 npm install。
//
// 需要的环境变量（在 Render 后台填）：
//   DEEPSEEK_API_KEY = sk-你的密钥        （必填）
//   ALLOW_ORIGIN     = *                  （可选，默认 *）

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;          // Render 会自动注入 PORT
const KEY = process.env.DEEPSEEK_API_KEY || '';
const ALLOW = process.env.ALLOW_ORIGIN || '*';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  // ---------- 代理接口 ----------
  if (req.url === '/api/generate') {
    res.setHeader('Access-Control-Allow-Origin', ALLOW);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method !== 'POST') return sendJSON(res, 405, { error: '只接受 POST 请求' });
    if (!KEY) return sendJSON(res, 500, { error: '服务器未配置 DEEPSEEK_API_KEY 环境变量' });

    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); }
      catch { return sendJSON(res, 400, { error: '请求体不是合法 JSON' }); }

      const { messages, temperature } = body;
      if (!Array.isArray(messages)) return sendJSON(res, 400, { error: '请求体缺少 messages 数组' });

      try {
        const r = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages,
            temperature: typeof temperature === 'number' ? temperature : 0.7,
            response_format: { type: 'json_object' },
          }),
        });
        const data = await r.json();
        return sendJSON(res, r.status, data);
      } catch (err) {
        return sendJSON(res, 502, { error: '代理转发失败：' + (err.message || err) });
      }
    });
    return;
  }

  // ---------- 静态文件 ----------
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 防目录穿越
  const safe = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safe);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // 找不到就回首页（单页站点的兜底）
      fs.readFile(path.join(__dirname, 'index.html'), (e2, home) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(home);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

server.listen(PORT, () => console.log('溯源 running on port ' + PORT));
