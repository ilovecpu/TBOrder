#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════
 *  🍚 The Bap (더밥) — TBOrder Local Server v4.0
 * ════════════════════════════════════════════════════════════
 *
 *  역할:
 *   1) HTML 파일 서빙 (주문/주방/관리자 키오스크)
 *   2) WebSocket 실시간 통신 (주문 → 주방) — ws 패키지 사용
 *   3) REST API (상태 확인, 주문 데이터)
 *
 *  설치: npm install ws
 *  실행: node tb-server.js
 *  포트: 8080 (기본) / 환경변수 TB_PORT로 변경 가능
 *
 *  URL:
 *   http://[IP]:8080/          → 런처 (index.html)
 *   http://[IP]:8080/order     → 고객 주문 키오스크
 *   http://[IP]:8080/kitchen   → 주방 디스플레이
 *   http://[IP]:8080/admin     → 관리자 패널
 *   http://[IP]:8080/test      → 통신 진단 도구
 *   http://[IP]:8080/status    → 서버 상태
 *
 * ════════════════════════════════════════════════════════════
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── ws 패키지 로드 (없으면 자동 설치 안내) ───
let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.error('');
  console.error('  ⚠️  ws 패키지가 필요합니다!');
  console.error('  아래 명령어를 실행한 후 다시 시작하세요:');
  console.error('');
  console.error('    npm install ws');
  console.error('');
  process.exit(1);
}

const PORT = parseInt(process.env.TB_PORT) || 8080;

// ─── 로컬 IP 자동 감지 ───
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const LOCAL_IP = getLocalIP();

// ─── 연결된 클라이언트 ───
const clients = new Map();
let clientIdCounter = 0;

// ─── 일일 주문 저장소 ───
let dailyOrders = [];
let dailyStartTime = new Date().toISOString();

// ─── MIME Types ───
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ─── URL 라우팅 → 파일 매핑 ───
const ROUTES = {
  '/order': 'TBOrder_Kiosk.html',
  '/kitchen': 'TBKitchen_Kiosk.html',
  '/admin': 'TBMain_Kiosk.html',
  '/test': 'test.html',
};

// ─── 유틸리티 ───
function getClientSummary() {
  const summary = { order: 0, kitchen: 0, admin: 0, test: 0 };
  clients.forEach(c => {
    if (c.type && summary[c.type] !== undefined) summary[c.type]++;
  });
  return summary;
}

function broadcastMsg(message, excludeId = null) {
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  clients.forEach((client, id) => {
    if (id === excludeId) return;
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    } catch (e) {
      console.error(`    ⚠️ 전송 실패 #${id}:`, e.message);
    }
  });
}

function sendTo(clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  try {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  } catch (e) {
    console.error(`    ⚠️ 전송 실패 #${clientId}:`, e.message);
  }
}

// ─── 메시지 핸들러 ───
function handleMessage(clientId, rawData) {
  let msg;
  try {
    msg = JSON.parse(rawData);
  } catch (e) {
    console.error(`    ⚠️ JSON 파싱 실패 #${clientId}:`, rawData.substring(0, 100));
    return;
  }
  const client = clients.get(clientId);
  if (!client) return;

  switch (msg.type) {
    case 'register': {
      client.type = msg.clientType;
      client.branch = msg.branchCode || '';
      console.log(`  ✅ [${(msg.clientType || '?').toUpperCase()}] ${client.branch || 'no-branch'} 등록 (ID: ${clientId})`);
      sendTo(clientId, {
        type: 'registered',
        clientId,
        serverIP: LOCAL_IP,
        connectedClients: getClientSummary(),
        dailyOrderCount: dailyOrders.length
      });
      broadcastMsg({
        type: 'client_connected',
        clientType: msg.clientType,
        connectedClients: getClientSummary()
      }, clientId);
      break;
    }

    case 'new_order': {
      const order = msg.order;
      if (!order) {
        console.error('    ⚠️ 주문 데이터 없음');
        break;
      }
      console.log(`  📋 [주문] ${order.orderNumber} (${order.branchCode || '?'}) — £${order.total}`);
      dailyOrders.push({ ...order, receivedAt: new Date().toISOString() });

      // 주방 + 관리자에게 전달
      let sentCount = 0;
      clients.forEach((c, id) => {
        if (id === clientId) return;
        if (c.type === 'kitchen') {
          sendTo(id, { type: 'new_order', order });
          sentCount++;
          console.log(`    → 주방 #${id} 전달 완료`);
        }
        if (c.type === 'admin') {
          sendTo(id, { type: 'new_order', order });
          console.log(`    → 관리자 #${id} 전달 완료`);
        }
      });
      if (sentCount === 0) {
        console.log(`    ⚠️ 연결된 주방이 없음! (현재: ${[...clients.values()].map(c => c.type || '?').join(',')})`);
      }
      break;
    }

    case 'order_status': {
      console.log(`  🔄 [상태] ${msg.orderNumber} → ${msg.status}`);
      const found = dailyOrders.find(o => o.orderNumber === msg.orderNumber);
      if (found) {
        found.status = msg.status;
        found.statusUpdatedAt = new Date().toISOString();
      }
      broadcastMsg({
        type: 'order_status',
        orderNumber: msg.orderNumber,
        status: msg.status
      }, clientId);
      break;
    }

    case 'menu_update': {
      console.log('  📝 [메뉴 업데이트]');
      broadcastMsg({
        type: 'menu_update',
        menuData: msg.menuData,
        timestamp: new Date().toISOString()
      }, clientId);
      break;
    }

    case 'request_daily_data': {
      sendTo(clientId, {
        type: 'daily_data',
        orders: dailyOrders,
        startTime: dailyStartTime,
        endTime: new Date().toISOString()
      });
      break;
    }

    case 'end_of_day': {
      console.log(`  🌙 [마감] 총 ${dailyOrders.length}건`);
      sendTo(clientId, {
        type: 'eod_summary',
        totalOrders: dailyOrders.length,
        orders: dailyOrders,
        startTime: dailyStartTime,
        endTime: new Date().toISOString()
      });
      dailyOrders = [];
      dailyStartTime = new Date().toISOString();
      broadcastMsg({ type: 'day_reset', timestamp: new Date().toISOString() });
      break;
    }

    case 'ping': {
      sendTo(clientId, { type: 'pong', timestamp: Date.now() });
      break;
    }
  }
}

// ─── HTTP 서버 ───
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  // ─── REST API ───
  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      ip: LOCAL_IP,
      port: PORT,
      uptime: process.uptime(),
      clients: getClientSummary(),
      dailyOrders: dailyOrders.length
    }));
    return;
  }

  if (url === '/api/orders') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ orders: dailyOrders, count: dailyOrders.length }));
    return;
  }

  if (url === '/api/ip') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip: LOCAL_IP, port: PORT, wsUrl: `ws://${LOCAL_IP}:${PORT}` }));
    return;
  }

  // ─── URL 라우팅 ───
  let filePath;
  if (url === '/' || url === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else if (ROUTES[url]) {
    filePath = path.join(__dirname, ROUTES[url]);
  } else if (url === '/status') {
    filePath = null;
  } else {
    filePath = path.join(__dirname, url);
  }

  // ─── 서버 상태 페이지 ───
  if (url === '/status') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>TBOrder Server</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#0D0D0D;color:#fff;padding:40px;min-height:100vh}
.c{max-width:600px;margin:0 auto}.t{color:#E85D75;font-size:28px;font-weight:700;margin-bottom:8px}
.s{color:#666;margin-bottom:32px}.card{background:#1a1a1a;border:1px solid #333;border-radius:16px;padding:24px;margin:16px 0}
.row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #222}.row:last-child{border:none}
.l{color:#888}.v{color:#34C759;font-weight:600}.url{color:#E85D75;font-family:monospace;font-size:14px;padding:8px;background:#111;border-radius:8px;margin:4px 0;display:block}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px;background:#34C759;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}</style></head>
<body><div class="c"><div class="t">🍚 TBOrder Server v4.0</div><p class="s">더밥 키오스크 서버</p>
<div class="card"><div class="row"><span class="l">상태</span><span class="v"><span class="dot"></span>Running</span></div>
<div class="row"><span class="l">IP 주소</span><span class="v">${LOCAL_IP}</span></div>
<div class="row"><span class="l">포트</span><span class="v">${PORT}</span></div>
<div class="row"><span class="l">연결 기기</span><span class="v" id="cl">-</span></div>
<div class="row"><span class="l">오늘 주문</span><span class="v" id="od">-</span></div></div>
<div class="card"><p style="color:#888;margin-bottom:12px">접속 URL</p>
<span class="url">🖥️ 주문: http://${LOCAL_IP}:${PORT}/order</span>
<span class="url">🍳 주방: http://${LOCAL_IP}:${PORT}/kitchen</span>
<span class="url">⚙️ 관리: http://${LOCAL_IP}:${PORT}/admin</span>
<span class="url">🔧 진단: http://${LOCAL_IP}:${PORT}/test</span></div></div>
<script>setInterval(()=>{fetch('/api/health').then(r=>r.json()).then(d=>{
document.getElementById('cl').textContent='주문:'+d.clients.order+' 주방:'+d.clients.kitchen+' 관리:'+d.clients.admin;
document.getElementById('od').textContent=d.dailyOrders+'건';}).catch(()=>{});},3000);</script></body></html>`);
    return;
  }

  // ─── 파일 서빙 ───
  if (!filePath) { res.writeHead(404); res.end('Not Found'); return; }

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(__dirname))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ─── WebSocket 서버 (ws 패키지) ───
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const clientId = ++clientIdCounter;
  const remoteIP = req.socket.remoteAddress || '?';
  clients.set(clientId, { ws, type: null, branch: '', connectedAt: new Date().toISOString(), ip: remoteIP });
  console.log(`  🔌 클라이언트 연결 #${clientId} (IP: ${remoteIP}, 총 ${clients.size}대)`);

  ws.on('message', (data) => {
    try {
      const rawData = typeof data === 'string' ? data : data.toString('utf8');
      handleMessage(clientId, rawData);
    } catch (e) {
      console.error(`  ⚠️ 메시지 처리 오류 #${clientId}:`, e.message);
    }
  });

  ws.on('close', (code, reason) => {
    const c = clients.get(clientId);
    clients.delete(clientId);
    console.log(`  ❌ 연결 해제 #${clientId} (${c?.type || '?'}) code=${code} (남은: ${clients.size}대)`);
    broadcastMsg({ type: 'client_disconnected', connectedClients: getClientSummary() });
  });

  ws.on('error', (err) => {
    console.error(`  ⚠️ WebSocket 오류 #${clientId}:`, err.message);
    clients.delete(clientId);
  });

  // Ping/Pong keep-alive (30초마다)
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on('close', () => clearInterval(pingInterval));
});

// ─── 서버 시작 ───
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║                                                  ║');
  console.log('  ║   🍚  TBOrder Server v4.0 (ws)                   ║');
  console.log('  ║   The Bap (더밥) Kiosk System                    ║');
  console.log('  ║                                                  ║');
  console.log(`  ║   📡  IP:   ${LOCAL_IP.padEnd(36)}║`);
  console.log(`  ║   🌐  Port: ${String(PORT).padEnd(36)}║`);
  console.log('  ║                                                  ║');
  console.log(`  ║   🖥️  주문:  http://${LOCAL_IP}:${PORT}/order`.padEnd(55) + '║');
  console.log(`  ║   🍳  주방:  http://${LOCAL_IP}:${PORT}/kitchen`.padEnd(55) + '║');
  console.log(`  ║   ⚙️  관리:  http://${LOCAL_IP}:${PORT}/admin`.padEnd(55) + '║');
  console.log(`  ║   🔧  진단:  http://${LOCAL_IP}:${PORT}/test`.padEnd(55) + '║');
  console.log(`  ║   📊  상태:  http://${LOCAL_IP}:${PORT}/status`.padEnd(55) + '║');
  console.log('  ║                                                  ║');
  console.log('  ║   주방 태블릿에서 위 주방 URL을 열어주세요       ║');
  console.log('  ║                                                  ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
});

// ─── 종료 처리 ───
process.on('SIGINT', () => {
  console.log('\n  🌙 서버 종료 중...');
  broadcastMsg({ type: 'server_shutdown' });
  clients.forEach((c) => {
    try { c.ws.close(1001, 'Server shutting down'); } catch (e) {}
  });
  wss.close(() => {
    server.close(() => {
      console.log('  ✅ 서버 종료 완료');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(0), 3000);
});

process.on('uncaughtException', (err) => {
  console.error('  🔥 예상치 못한 오류:', err.message);
  console.error(err.stack);
});
