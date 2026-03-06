#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════
 *  🍚 The Bap (더밥) — TBOrder Local Server v1.1
 *  Last Updated: 2026-03-06
 * ════════════════════════════════════════════════════════════
 *
 *  역할:
 *   1) HTML 파일 서빙 (주문/주방/관리자 키오스크)
 *   2) WebSocket 실시간 통신 (주문 → 주방) — ws 패키지 사용
 *   3) REST API (상태 확인, 주문 데이터)
 *   4) Stripe Terminal 카드 결제 처리
 *
 *  설치: npm install
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

// ─── ws 패키지 로드 ───
let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.error('');
  console.error('  ⚠️  패키지 설치가 필요합니다!');
  console.error('  아래 명령어를 실행한 후 다시 시작하세요:');
  console.error('');
  console.error('    npm install');
  console.error('');
  process.exit(1);
}

// ─── Stripe 패키지 로드 ───
let stripe = null;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_TERMINAL_LOCATION = process.env.STRIPE_LOCATION_ID || '';

if (STRIPE_SECRET_KEY) {
  try {
    const Stripe = require('stripe');
    stripe = Stripe(STRIPE_SECRET_KEY);
    console.log('  💳 Stripe Terminal 활성화');
  } catch (e) {
    console.error('  ⚠️ stripe 패키지 로드 실패:', e.message);
  }
} else {
  console.log('  ℹ️  Stripe 미설정 (STRIPE_SECRET_KEY 환경변수 필요)');
  console.log('     카드 결제 없이 주문만 가능합니다.');
}

const PORT = parseInt(process.env.TB_PORT) || 8080;
const GOOGLE_MENU_API = process.env.GOOGLE_MENU_API || 'https://script.google.com/macros/s/AKfycbxMZ5PQbti-dKYUgJQJl3Yn0maegOwLyj3nIWL5Lsltx3jM8ZJ2v4CSGDp73BQq4VJ3WA/exec';

// ─── 메뉴 데이터 로드/캐시 ───
const MENU_FILE = path.join(__dirname, 'data', 'menu.json');

function loadMenuData() {
  try {
    if (fs.existsSync(MENU_FILE)) {
      return JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('  ⚠️ menu.json 로드 실패:', e.message);
  }
  return { version: 0, categories: [], items: [], sauces: [] };
}

function saveMenuData(menuData) {
  menuData.lastUpdated = new Date().toISOString();
  menuData.version = (menuData.version || 0) + 1;
  try {
    fs.writeFileSync(MENU_FILE, JSON.stringify(menuData, null, 2), 'utf8');
    console.log(`  📝 메뉴 저장 완료 (v${menuData.version}, ${menuData.items?.length || 0}개 아이템)`);
  } catch (e) {
    console.error('  ⚠️ 메뉴 저장 실패:', e.message);
  }
}

let menuCache = loadMenuData();
console.log(`  🍱 메뉴 로드: ${menuCache.categories?.length || 0}개 카테고리, ${menuCache.items?.length || 0}개 아이템`);

// Google Sheets에서 메뉴 동기화 (시작 시 + 주기적)
async function syncMenuFromGoogle() {
  if (!GOOGLE_MENU_API) return;
  try {
    const https = require('https');
    const url = GOOGLE_MENU_API + '?action=menu';
    const data = await new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : require('http');
      proto.get(url, { timeout: 10000 }, (res) => {
        // Follow redirects (Apps Script redirects)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          proto.get(res.headers.location, { timeout: 10000 }, (res2) => {
            let d = '';
            res2.on('data', c => d += c);
            res2.on('end', () => resolve(d));
          }).on('error', reject);
          return;
        }
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      }).on('error', reject);
    });
    const parsed = JSON.parse(data);
    if (parsed.categories && parsed.items) {
      menuCache = { ...menuCache, ...parsed, lastSynced: new Date().toISOString() };
      saveMenuData(menuCache);
      console.log(`  ☁️  Google Sheets 메뉴 동기화 완료 (${parsed.items.length}개 아이템)`);
      // 모든 클라이언트에게 메뉴 업데이트 알림
      broadcastMsg({ type: 'menu_update', menuData: menuCache, timestamp: new Date().toISOString() });
    }
  } catch (e) {
    console.log(`  ⚠️ Google Sheets 동기화 실패: ${e.message}`);
  }
}

// Google Sheets에 메뉴 업로드
async function syncMenuToGoogle(menuData) {
  if (!GOOGLE_MENU_API) return;
  try {
    const https = require('https');
    const postData = JSON.stringify({
      action: 'updateMenu',
      categories: menuData.categories,
      items: menuData.items,
      sauces: menuData.sauces,
    });
    const urlObj = new URL(GOOGLE_MENU_API);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 15000,
    };
    await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          console.log(`  ☁️  Google Sheets 업로드 완료`);
          resolve(d);
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  } catch (e) {
    console.log(`  ⚠️ Google Sheets 업로드 실패: ${e.message}`);
  }
}

// Google Sheets 동기화: 시작 시 + 5분마다
if (GOOGLE_MENU_API) {
  console.log(`  ☁️  Google Sheets 연동 활성화`);
  setTimeout(syncMenuFromGoogle, 3000);
  setInterval(syncMenuFromGoogle, 5 * 60 * 1000);
}

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

// ─── 주문 데이터 파일 저장 ───
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function getOrderFilePath(dateStr) {
  return path.join(DATA_DIR, `orders_${dateStr}.json`);
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

function loadOrders(dateStr) {
  const filePath = getOrderFilePath(dateStr);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error(`  ⚠️ 주문 파일 로드 실패 (${dateStr}):`, e.message);
  }
  return [];
}

function saveOrders() {
  const filePath = getOrderFilePath(getTodayStr());
  try {
    fs.writeFileSync(filePath, JSON.stringify(dailyOrders, null, 2), 'utf8');
  } catch (e) {
    console.error('  ⚠️ 주문 파일 저장 실패:', e.message);
  }
}

// 시작 시 오늘 주문 로드
let dailyOrders = loadOrders(getTodayStr());
let dailyStartTime = new Date().toISOString();
console.log(`  📂 저장된 주문 ${dailyOrders.length}건 로드 (${getTodayStr()})`);

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
  '/pos': 'TBPos.html',
  '/test': 'test.html',
};

// ─── 유틸리티 ───
function getClientSummary() {
  const summary = { order: 0, kitchen: 0, admin: 0, pos: 0, test: 0 };
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

      // 주방/관리자/POS가 새로 연결되면 기존 주문 전송
      if ((msg.clientType === 'kitchen' || msg.clientType === 'admin' || msg.clientType === 'pos') && dailyOrders.length > 0) {
        // 주방: 완료되지 않은 주문만 / 관리자,POS: 전부
        const ordersToSend = msg.clientType === 'kitchen'
          ? dailyOrders.filter(o => o.status !== 'done' && o.status !== 'completed')
          : dailyOrders;
        console.log(`    📦 기존 주문 ${ordersToSend.length}/${dailyOrders.length}건 전송 → #${clientId} (${msg.clientType})`);
        ordersToSend.forEach(order => {
          sendTo(clientId, { type: 'new_order', order });
        });
      }
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
      saveOrders();

      // 주방 + 관리자 + POS에게 전달
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
        if (c.type === 'pos') {
          sendTo(id, { type: 'new_order', order });
          console.log(`    → POS #${id} 전달 완료`);
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
        saveOrders();
      }
      broadcastMsg({
        type: 'order_status',
        orderNumber: msg.orderNumber,
        status: msg.status
      }, clientId);
      break;
    }

    case 'menu_update': {
      console.log('  📝 [메뉴 업데이트 via WS]');
      // 로컬 캐시도 업데이트
      if (msg.menuData) {
        if (msg.menuData.categories) menuCache.categories = msg.menuData.categories;
        if (msg.menuData.items) menuCache.items = msg.menuData.items;
        if (msg.menuData.sauces) menuCache.sauces = msg.menuData.sauces;
        saveMenuData(menuCache);
      }
      broadcastMsg({
        type: 'menu_update',
        menuData: menuCache,
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
      saveOrders();
      broadcastMsg({ type: 'day_reset', timestamp: new Date().toISOString() });
      break;
    }

    case 'delete_order': {
      const orderNum = msg.orderNumber;
      console.log(`  🗑️ [삭제] 주문 ${orderNum}`);
      dailyOrders = dailyOrders.filter(o => o.orderNumber !== orderNum);
      saveOrders();
      // 다른 클라이언트에게 삭제 전파
      broadcastMsg({ type: 'order_deleted', orderNumber: orderNum }, clientId);
      break;
    }

    case 'clear_orders': {
      console.log(`  🗑️ [전체삭제] ${dailyOrders.length}건 삭제`);
      dailyOrders = [];
      saveOrders();
      // 다른 클라이언트에게 전체 삭제 전파
      broadcastMsg({ type: 'orders_cleared' }, clientId);
      break;
    }

    case 'ping': {
      sendTo(clientId, { type: 'pong', timestamp: Date.now() });
      break;
    }
  }
}

// ─── HTTP 서버 ───
const server = http.createServer(async (req, res) => {
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
    // ?date=YYYY-MM-DD 로 과거 주문 조회 가능
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const dateParam = urlParams.get('date');
    const targetDate = dateParam || getTodayStr();
    const orders = (targetDate === getTodayStr()) ? dailyOrders : loadOrders(targetDate);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ date: targetDate, orders, count: orders.length }));
    return;
  }

  // 저장된 주문 날짜 목록
  if (url === '/api/orders/dates') {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('orders_') && f.endsWith('.json'));
      const dates = files.map(f => f.replace('orders_', '').replace('.json', '')).sort().reverse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dates }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dates: [getTodayStr()] }));
    }
    return;
  }

  if (url === '/api/ip') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip: LOCAL_IP, port: PORT, wsUrl: `ws://${LOCAL_IP}:${PORT}` }));
    return;
  }

  // ─── Stripe Terminal API ───

  // 1) Connection Token — Stripe Terminal JS SDK가 리더 연결할 때 필요
  if (url === '/api/stripe/connection-token' && req.method === 'POST') {
    if (!stripe) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stripe not configured' }));
      return;
    }
    try {
      const token = await stripe.terminal.connectionTokens.create();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ secret: token.secret }));
    } catch (e) {
      console.error('  ⚠️ Connection Token 오류:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 2) PaymentIntent 생성 — 결제 금액 설정
  if (url === '/api/stripe/create-payment-intent' && req.method === 'POST') {
    if (!stripe) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stripe not configured' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { amount, orderNumber, branchCode } = JSON.parse(body);
        // amount는 pence 단위 (예: £8.25 → 825)
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount),
          currency: 'gbp',
          payment_method_types: ['card_present'],
          capture_method: 'automatic',
          description: `The Bap ${branchCode} — Order ${orderNumber}`,
          metadata: { orderNumber, branchCode }
        });
        console.log(`  💳 PaymentIntent 생성: ${paymentIntent.id} (£${(amount/100).toFixed(2)})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id }));
      } catch (e) {
        console.error('  ⚠️ PaymentIntent 오류:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 3) 결제 상태 확인
  if (url.startsWith('/api/stripe/payment-status/') && req.method === 'GET') {
    if (!stripe) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stripe not configured' }));
      return;
    }
    const piId = url.split('/').pop();
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: pi.status, amount: pi.amount }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Menu API ───
  if (url === '/api/menu' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(menuCache));
    return;
  }

  if (url === '/api/menu' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const action = data.action || 'updateAll';

        if (action === 'updateAll') {
          // menuData 키 안에 있을 수도 있고, 최상위에 있을 수도 있음
          const src = data.menuData || data;
          if (src.categories) menuCache.categories = src.categories;
          if (src.items) menuCache.items = src.items;
          if (src.sauces) menuCache.sauces = src.sauces;
          if (src.branchPricing) menuCache.branchPricing = src.branchPricing;
        } else if (action === 'addItem' && data.item) {
          menuCache.items.push(data.item);
        } else if (action === 'updateItem' && data.item) {
          const idx = menuCache.items.findIndex(i => i.id === data.item.id);
          if (idx >= 0) menuCache.items[idx] = { ...menuCache.items[idx], ...data.item };
        } else if (action === 'deleteItem' && data.itemId) {
          menuCache.items = menuCache.items.filter(i => i.id !== data.itemId);
        } else if (action === 'updateCategories' && data.categories) {
          menuCache.categories = data.categories;
        } else if (action === 'syncToGoogle') {
          // 로컬 → Google Sheets 동기화
          syncMenuToGoogle(menuCache);
        } else if (action === 'syncFromGoogle') {
          syncMenuFromGoogle();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Sync started' }));
          return;
        }

        saveMenuData(menuCache);

        // 모든 클라이언트에게 메뉴 업데이트 알림
        broadcastMsg({ type: 'menu_update', menuData: menuCache, timestamp: new Date().toISOString() });

        // Google Sheets에도 동기화 (설정된 경우)
        if (GOOGLE_MENU_API && action !== 'syncFromGoogle') {
          syncMenuToGoogle(menuCache);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, version: menuCache.version }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url === '/api/menu/sync' && req.method === 'POST') {
    syncMenuFromGoogle();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Google Sheets sync started' }));
    return;
  }

  // 4) Stripe 상태 확인
  if (url === '/api/stripe/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      enabled: !!stripe,
      hasSecretKey: !!STRIPE_SECRET_KEY,
      locationId: STRIPE_TERMINAL_LOCATION || null
    }));
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
<span class="url">💰 POS:  http://${LOCAL_IP}:${PORT}/pos</span>
<span class="url">🔧 진단: http://${LOCAL_IP}:${PORT}/test</span></div></div>
<script>setInterval(()=>{fetch('/api/health').then(r=>r.json()).then(d=>{
document.getElementById('cl').textContent='주문:'+d.clients.order+' 주방:'+d.clients.kitchen+' POS:'+d.clients.pos+' 관리:'+d.clients.admin;
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
  console.log('  ║   🍚  TBOrder Server v5.0 (ws + Stripe)           ║');
  console.log('  ║   The Bap (더밥) Kiosk System                    ║');
  console.log(`  ║   💳  Stripe: ${stripe ? '✅ Active' : '❌ Not configured'}`.padEnd(55) + '║');
  console.log('  ║                                                  ║');
  console.log(`  ║   📡  IP:   ${LOCAL_IP.padEnd(36)}║`);
  console.log(`  ║   🌐  Port: ${String(PORT).padEnd(36)}║`);
  console.log('  ║                                                  ║');
  console.log(`  ║   🖥️  주문:  http://${LOCAL_IP}:${PORT}/order`.padEnd(55) + '║');
  console.log(`  ║   🍳  주방:  http://${LOCAL_IP}:${PORT}/kitchen`.padEnd(55) + '║');
  console.log(`  ║   ⚙️  관리:  http://${LOCAL_IP}:${PORT}/admin`.padEnd(55) + '║');
  console.log(`  ║   💰  POS:   http://${LOCAL_IP}:${PORT}/pos`.padEnd(55) + '║');
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
