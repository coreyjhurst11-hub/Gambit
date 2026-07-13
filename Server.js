// Gambit · Tournament Director — static server + tournament registry API
// Zero dependencies. Railway sets process.env.PORT.
// Registry storage: JSON files under DATA_DIR (attach a Railway Volume to persist across deploys).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'gambit-registry')
  : (process.env.DATA_DIR || path.join(__dirname, 'data'));

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

const ID_RE = /^GMB-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const MAX_BODY = 2 * 1024 * 1024; // 2 MB per tournament

function send(res, code, obj, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type' }, headers || {});
  res.writeHead(code, h);
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}
function idPath(id) { return path.join(DATA_DIR, id + '.json'); }

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // ---- CORS preflight ----
  if (req.method === 'OPTIONS') { send(res, 204, ''); return; }

  // ---- API: publish ----
  if (req.method === 'POST' && urlPath === '/api/publish') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > MAX_BODY) { send(res, 413, { error: 'too large' }); req.destroy(); } });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const id = String(j.id || '').toUpperCase();
        if (!ID_RE.test(id)) { send(res, 400, { error: 'invalid id' }); return; }
        if (!j.tournament || !j.tournament.players) { send(res, 400, { error: 'missing tournament' }); return; }
        const rec = { id, updatedAt: Date.now(), tournament: j.tournament, view: j.view || null };
        fs.writeFile(idPath(id), JSON.stringify(rec), err => {
          if (err) { send(res, 500, { error: 'store failed' }); return; }
          send(res, 200, { ok: true, id });
        });
      } catch (e) { send(res, 400, { error: 'bad json' }); }
    });
    return;
  }

  // ---- API: lightweight spectator snapshot ----
  if (req.method === 'GET' && urlPath.startsWith('/api/view/')) {
    const id = urlPath.slice('/api/view/'.length).toUpperCase();
    if (!ID_RE.test(id)) { send(res, 400, { error: 'invalid id' }); return; }
    fs.readFile(idPath(id), 'utf8', (err, data) => {
      if (err) { send(res, 404, { error: 'not found' }); return; }
      try {
        const rec = JSON.parse(data);
        const view = rec.view || null;
        if (!view) { send(res, 404, { error: 'no live view for this tournament' }); return; }
        send(res, 200, { id: rec.id, updatedAt: rec.updatedAt, view });
      } catch (e) { send(res, 500, { error: 'read failed' }); }
    });
    return;
  }

  // ---- API: lookup (full tournament, for the app) ----
  if (req.method === 'GET' && urlPath.startsWith('/api/t/')) {
    const id = urlPath.slice('/api/t/'.length).toUpperCase();
    if (!ID_RE.test(id)) { send(res, 400, { error: 'invalid id' }); return; }
    fs.readFile(idPath(id), 'utf8', (err, data) => {
      if (err) { send(res, 404, { error: 'not found' }); return; }
      send(res, 200, data);
    });
    return;
  }

  // ---- API: registry stats (handy sanity check) ----
  if (req.method === 'GET' && urlPath === '/api/stats') {
    fs.readdir(DATA_DIR, (err, files) => {
      send(res, 200, { tournaments: err ? 0 : files.filter(f => f.endsWith('.json')).length });
    });
    return;
  }

  // ---- Static app ----
  // friendly routes for the spectator page
  if (urlPath === '/view' || urlPath === '/live' || urlPath === '/watch') {
    fs.readFile(path.join(ROOT, 'view.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('view.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }
  let p = urlPath === '/' || urlPath === '' ? '/index.html' : urlPath;
  const safe = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
  fs.readFile(path.join(ROOT, safe), (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, 'index.html'), (e2, home) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(home);
      });
      return;
    }
    const ext = path.extname(safe).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Gambit running on port ' + PORT + ' | registry dir: ' + DATA_DIR);
});
