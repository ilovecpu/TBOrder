#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════
 *  🍚 The Bap (더밥) — TBOrder Local Server v3.0
 *  Last Updated: 2026-03-12
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

// ─── ESC/POS 프린터 모듈 ───
const printer = require('./tb-printer');

const PORT = parseInt(process.env.TB_PORT) || 8080;
const BRANCH_CODE = process.env.TB_BRANCH || 'TB';   // 지점코드: TB, PAB 등 (실행: TB_BRANCH=PAB node tb-server.js)
const SERVER_VERSION = '3.0';
const SERVER_START_TIME = new Date().toISOString();
const GOOGLE_MENU_API = process.env.GOOGLE_MENU_API || 'https://script.google.com/macros/s/AKfycbzoEItk-hU2BPDyj_Dy1Vwxzu-R7PQoZYVzwzVsdPuTJWYCykVIWdWTwG8nieWCwaUD7w/exec';
const GOOGLE_API = process.env.GOOGLE_API || 'https://script.google.com/macros/s/AKfycbzoEItk-hU2BPDyj_Dy1Vwxzu-R7PQoZYVzwzVsdPuTJWYCykVIWdWTwG8nieWCwaUD7w/exec';

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

// boolean 정규화 유틸리티 — 문자열 "false"/"FALSE"/"true"/"TRUE" → boolean
function toBool(val, defaultVal = true) {
  if (val === true || val === 'true' || val === 'TRUE') return true;
  if (val === false || val === 'false' || val === 'FALSE') return false;
  return defaultVal;  // undefined/null/'' → 기본값
}

function saveMenuData(menuData) {
  menuData.lastUpdated = new Date().toISOString();
  menuData.version = (menuData.version || 0) + 1;

  // ─── boolean 필드 정규화 (문자열 → boolean 강제 변환) ───
  if (menuData.categories) {
    menuData.categories.forEach(c => {
      c.showInKiosk = toBool(c.showInKiosk, true);
      c.showInPos = toBool(c.showInPos, true);
      c.active = toBool(c.active, true);
    });
  }
  if (menuData.items) {
    menuData.items.forEach(i => {
      i.showOnKiosk = toBool(i.showOnKiosk, true);
      i.showOnPos = toBool(i.showOnPos, true);
      i.active = toBool(i.active, true);
    });
  }

  // 카테고리 중복 제거 (같은 ID → 마지막 것 유지)
  if (menuData.categories && menuData.categories.length > 0) {
    const catSeen = new Map();
    menuData.categories.forEach(c => catSeen.set(c.id, c));
    const catBefore = menuData.categories.length;
    menuData.categories = [...catSeen.values()];
    if (menuData.categories.length < catBefore) {
      console.log(`  🔧 중복 카테고리 제거: ${catBefore} → ${menuData.categories.length}`);
    }
  }
  // 아이템 중복 제거 (같은 ID → 마지막 것 유지)
  if (menuData.items && menuData.items.length > 0) {
    const seen = new Map();
    menuData.items.forEach(i => seen.set(i.id, i));
    const before = menuData.items.length;
    menuData.items = [...seen.values()];
    if (menuData.items.length < before) {
      console.log(`  🔧 중복 아이템 제거: ${before} → ${menuData.items.length}`);
    }
  }
  try {
    safeWriteFileSync(MENU_FILE, JSON.stringify(menuData, null, 2));
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
      // ─── 카테고리 병합 ───
      // dirty = Admin 편집이 아직 Google에 업로드 안 됨 → 서버 로컬값 우선 (Google은 아직 이전 데이터)
      // clean = Google과 동기화 완료 → Google 값 그대로 수용 (Google이 source of truth)
      if (parsed.categories && menuCache.categories && _localMenuDirty) {
        console.log('  ⚠️  로컬 변경 미업로드 상태 — 서버 visibility 값 유지');
        const existMap = {};
        menuCache.categories.forEach(c => { existMap[c.id] = c; });
        parsed.categories = parsed.categories.map(gc => {
          const existing = existMap[gc.id] || {};
          return {
            ...gc,
            showInKiosk: existing.showInKiosk !== undefined ? existing.showInKiosk : gc.showInKiosk,
            showInPos: existing.showInPos !== undefined ? existing.showInPos : gc.showInPos,
          };
        });
      }
      // 아이템 병합 (dirty일 때만 서버 우선)
      if (parsed.items && menuCache.items && _localMenuDirty) {
        const existItemMap = {};
        menuCache.items.forEach(i => { existItemMap[i.id] = i; });
        parsed.items = parsed.items.map(gi => {
          const existing = existItemMap[gi.id] || {};
          return {
            ...gi,
            showOnKiosk: existing.showOnKiosk !== undefined ? existing.showOnKiosk : gi.showOnKiosk,
            showOnPos: existing.showOnPos !== undefined ? existing.showOnPos : gi.showOnPos,
          };
        });
      }
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

// ─── Google Sheets 동기화 디바운스 (중복 방지 핵심) ───
// 여러 Admin 편집이 빠르게 연속 발생하면, 마지막 편집 후 2.5초 뒤 1회만 동기화
let _googleSyncTimer = null;
let _googleSyncInProgress = false;
// dirty flag: Admin 편집 후 Google에 아직 업로드 안 된 상태면 true
// syncFromGoogle가 아직 업로드 안 된 로컬 변경을 Google의 이전 데이터로 덮어쓰는 것을 방지
let _localMenuDirty = false;

function debouncedSyncMenuToGoogle(menuData) {
  _localMenuDirty = true;  // 로컬 변경 발생 표시
  if (_googleSyncTimer) {
    clearTimeout(_googleSyncTimer);
  }
  _googleSyncTimer = setTimeout(async () => {
    _googleSyncTimer = null;
    if (_googleSyncInProgress) {
      console.log('  ⏳ Google Sheets 동기화 진행 중 — 스킵');
      return;
    }
    _googleSyncInProgress = true;
    try {
      // 동기화 시점의 최신 menuCache 사용 (디바운스 대기 중 추가 편집 반영)
      await syncMenuToGoogle(menuCache);
      _localMenuDirty = false;  // 업로드 완료 → Google과 동기화됨
      console.log('  ✅ Google 동기화 완료, dirty flag 해제');
    } finally {
      _googleSyncInProgress = false;
    }
  }, 2500);
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
      branchPricing: menuData.branchPricing,
      branches: menuData.branches,
      branchVisibility: menuData.branchVisibility,
      allergens: menuData.allergens,
      nutrition: menuData.nutrition,
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

// ★ TBMS에서 브랜치(지점) 목록 동기화
async function syncBranchesFromTBMS() {
  if (!GOOGLE_API) return;
  try {
    const https = require('https');
    const url = GOOGLE_API + '?action=stores';
    const data = await new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : require('http');
      proto.get(url, { timeout: 10000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          proto.get(res.headers.location, { timeout: 10000 }, (res2) => {
            let d = ''; res2.on('data', c => d += c); res2.on('end', () => resolve(d));
          }).on('error', reject);
          return;
        }
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
      }).on('error', reject);
    });
    const parsed = JSON.parse(data);
    const stores = parsed.stores?.data || parsed.stores || [];
    if (stores.length > 0) {
      const branches = stores
        .filter(s => s.active !== false && s.active !== 'false')
        .map(s => ({
          code: s.code || s.id, name: s.name,
          nameKr: s.nameKr || '', phone: String(s.phone || ''),
          company: s.company || '', companyNo: s.companyNo || '',
          vatNo: s.vatNo || '', vatQuarter: s.vatQuarter || '',
          address: s.address || '', email: s.email || '',
          manager: s.manager || '', active: true
        }));
      menuCache.branches = branches;
      saveMenuData(menuCache);
      console.log(`  🏪 TBMS 브랜치 동기화 완료: ${branches.length}개 지점 (${branches.map(b=>b.code).join(', ')})`);
    }
  } catch (e) {
    console.log(`  ⚠️ TBMS 브랜치 동기화 실패: ${e.message}`);
  }
}

// Google Sheets 동기화: 시작 시 + 5분마다
if (GOOGLE_MENU_API) {
  console.log(`  ☁️  Google Sheets 연동 활성화`);
  setTimeout(syncMenuFromGoogle, 3000);
  setTimeout(syncBranchesFromTBMS, 4000); // 메뉴 로드 직후 브랜치 동기화
  setInterval(syncMenuFromGoogle, 3 * 60 * 1000);  // 3분마다 Google Sheets 동기화 (기존 5분→3분)
  setInterval(syncBranchesFromTBMS, 10 * 60 * 1000); // 10분마다 브랜치 동기화
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
const END_SALES_DIR = path.join(DATA_DIR, 'end_sales');
if (!fs.existsSync(END_SALES_DIR)) fs.mkdirSync(END_SALES_DIR, { recursive: true });

// Auto-recover last_end_sales.json from end_sales_log.json if missing
(function recoverLastEndSales() {
  const lePath = path.join(DATA_DIR, 'last_end_sales.json');
  if (fs.existsSync(lePath)) return; // already exists
  const logPath = path.join(DATA_DIR, 'end_sales_log.json');
  if (!fs.existsSync(logPath)) return; // no log either
  try {
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    if (!Array.isArray(log) || log.length === 0) return;
    const data = {};
    log.forEach(e => { if (e.branchCode && e.periodTo) data[e.branchCode] = e.periodTo; });
    safeWriteFileSync(lePath, JSON.stringify(data, null, 2));
    console.log('[Server] last_end_sales.json recovered from log:', data);
  } catch (e) { console.warn('[Server] last_end_sales recovery failed:', e.message); }
})();

function getMonthlyOrderFilePath(monthStr) {
  return path.join(DATA_DIR, `orders_${monthStr}.json`); // orders_2026-03.json
}

// 하위호환: 기존 일별 파일 경로
function getLegacyOrderFilePath(dateStr) {
  return path.join(DATA_DIR, `orders_${dateStr}.json`);
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

function getMonthStr(dateStr) {
  return dateStr.slice(0, 7); // 'YYYY-MM'
}

// 월별 파일에서 특정 날짜 주문 로드
function loadOrders(dateStr) {
  const monthStr = getMonthStr(dateStr);
  const monthFile = getMonthlyOrderFilePath(monthStr);
  try {
    if (fs.existsSync(monthFile)) {
      const data = JSON.parse(fs.readFileSync(monthFile, 'utf8'));
      return data[dateStr] || [];
    }
  } catch (e) {
    console.error(`  ⚠️ 월별 주문 파일 로드 실패 (${monthStr}):`, e.message);
  }
  // 하위호환: 기존 일별 파일 확인
  const legacyFile = getLegacyOrderFilePath(dateStr);
  try {
    if (fs.existsSync(legacyFile)) {
      const orders = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
      console.log(`  📦 레거시 일별 파일 → 월별 마이그레이션: ${dateStr}`);
      saveOrdersForDate(dateStr, orders);
      // 마이그레이션 후 일별 파일 삭제
      fs.unlinkSync(legacyFile);
      return orders;
    }
  } catch (e) {}
  return [];
}

// 특정 날짜의 주문을 월별 파일에 저장
function safeWriteFileSync(filePath, content) {
  // Atomic write: write to temp file → fsync → rename
  const tmpFile = filePath + '.tmp';
  const fd = fs.openSync(tmpFile, 'w');
  fs.writeSync(fd, content);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmpFile, filePath);
}

function saveOrdersForDate(dateStr, orders) {
  const monthStr = getMonthStr(dateStr);
  const monthFile = getMonthlyOrderFilePath(monthStr);
  let data = {};
  try {
    if (fs.existsSync(monthFile)) {
      data = JSON.parse(fs.readFileSync(monthFile, 'utf8'));
    }
  } catch (e) {}
  data[dateStr] = orders;
  safeWriteFileSync(monthFile, JSON.stringify(data, null, 2));
}

// ─── 날짜 추적 (자정 자동 전환용) ───
let currentDateStr = getTodayStr();

function saveOrders() {
  try {
    saveOrdersForDate(currentDateStr, dailyOrders);
  } catch (e) {
    console.error('  ⚠️ 주문 파일 저장 실패:', e.message);
  }
}

// ★ 자정 자동 날짜 전환 — EOD 없이도 데이터 안전하게 분리
function checkDateRollover() {
  const now = getTodayStr();
  if (now !== currentDateStr) {
    console.log('');
    console.log(`  🌅 ═══ 날짜 전환 감지: ${currentDateStr} → ${now} ═══`);

    // 1) 어제 데이터를 월별 파일에 확실히 저장
    try {
      saveOrdersForDate(currentDateStr, dailyOrders);
      console.log(`    💾 ${currentDateStr} 주문 ${dailyOrders.length}건 저장 완료`);
    } catch (e) {
      console.error(`    ⚠️ ${currentDateStr} 저장 실패:`, e.message);
    }

    // 2) 날짜 업데이트 & 오늘 주문 로드 (이미 존재하면)
    const prevDate = currentDateStr;
    currentDateStr = now;
    dailyOrders = loadOrders(now);
    console.log(`    📂 ${now} 주문 ${dailyOrders.length}건 로드`);

    // 3) 시작 시간 리셋
    dailyStartTime = new Date().toISOString();

    // 4) 연결된 클라이언트에 날짜 전환 알림
    broadcastMsg({
      type: 'day_reset',
      previousDate: prevDate,
      newDate: now,
      message: `날짜 전환: ${prevDate} → ${now}`
    });
    console.log(`    📡 클라이언트에 day_reset 전송`);
    console.log(`  🌅 ═══ 날짜 전환 완료 ═══`);
    console.log('');
  }
}

// 매 30초마다 날짜 전환 확인
setInterval(checkDateRollover, 30 * 1000);

// 시작 시 오늘 주문 로드
let dailyOrders = loadOrders(getTodayStr());
let dailyStartTime = new Date().toISOString();
console.log(`  📂 저장된 주문 ${dailyOrders.length}건 로드 (${getTodayStr()})`);

// ─── Register (Cash Till) 데이터 — 월별 파일 저장 ───
function getMonthlyRegisterFilePath(monthStr) {
  return path.join(DATA_DIR, `register_${monthStr}.json`); // register_2026-03.json
}

// 하위호환: 기존 일별 파일 경로
function getLegacyRegisterFilePath(dateStr) {
  return path.join(DATA_DIR, `register_${dateStr}.json`);
}

function loadRegister(dateStr) {
  const monthStr = getMonthStr(dateStr);
  const monthFile = getMonthlyRegisterFilePath(monthStr);
  try {
    if (fs.existsSync(monthFile)) {
      const data = JSON.parse(fs.readFileSync(monthFile, 'utf8'));
      return data[dateStr] || null;
    }
  } catch (e) {
    console.error(`  ⚠️ 월별 Register 파일 로드 실패 (${monthStr}):`, e.message);
  }
  // 하위호환: 기존 일별 파일 확인
  const legacyFile = getLegacyRegisterFilePath(dateStr);
  try {
    if (fs.existsSync(legacyFile)) {
      const reg = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
      console.log(`  📦 레거시 Register 일별 → 월별 마이그레이션: ${dateStr}`);
      saveRegisterForDate(dateStr, reg);
      fs.unlinkSync(legacyFile);
      return reg;
    }
  } catch (e) {}
  return null;
}

function saveRegisterForDate(dateStr, data) {
  const monthStr = getMonthStr(dateStr);
  const monthFile = getMonthlyRegisterFilePath(monthStr);
  let allData = {};
  try {
    if (fs.existsSync(monthFile)) {
      allData = JSON.parse(fs.readFileSync(monthFile, 'utf8'));
    }
  } catch (e) {}
  allData[dateStr] = data;
  safeWriteFileSync(monthFile, JSON.stringify(allData, null, 2));
}

function saveRegister(data) {
  const dateStr = data.date || getTodayStr();
  try {
    saveRegisterForDate(dateStr, data);
    console.log(`  💰 Register 저장: ${dateStr} (${data.branchCode || '?'})`);
  } catch (e) {
    console.error('  ⚠️ Register 파일 저장 실패:', e.message);
  }
}

// ─── Daily Summary 계산 ───
function calcDailySummary(dateStr) {
  const orders = (dateStr === getTodayStr()) ? dailyOrders : loadOrders(dateStr);
  const reg = loadRegister(dateStr);
  const cashOrders = orders.filter(o => o.paymentMethod === 'cash');
  const cardOrders = orders.filter(o => o.paymentMethod === 'card');
  return {
    date: dateStr,
    branchCode: orders[0]?.branchCode || reg?.branchCode || '',
    branchName: orders[0]?.branchName || reg?.branchName || '',
    totalOrders: orders.length,
    cashTotal: cashOrders.reduce((s, o) => s + (o.total || 0), 0),
    cardTotal: cardOrders.reduce((s, o) => s + (o.total || 0), 0),
    grandTotal: orders.reduce((s, o) => s + (o.total || 0), 0),
    openingFloat: reg?.openingFloat || 0
  };
}

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
  '/display': 'TBCustomerDisplay.html',
  '/test': 'test.html',
};

// ─── 유틸리티 ───
function getClientSummary() {
  const summary = { order: 0, kitchen: 0, admin: 0, pos: 0, customer_display: 0, test: 0 };
  clients.forEach(c => {
    if (c.type && summary[c.type] !== undefined) summary[c.type]++;
  });
  return summary;
}

function broadcastAll(message) { broadcastMsg(message, null); }

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
      client.branch = BRANCH_CODE;  // 서버 지점코드 강제 적용
      console.log(`  ✅ [${(msg.clientType || '?').toUpperCase()}] ${BRANCH_CODE} 등록 (ID: ${clientId})`);
      sendTo(clientId, {
        type: 'registered',
        clientId,
        serverIP: LOCAL_IP,
        branchCode: BRANCH_CODE,
        connectedClients: getClientSummary(),
        // ★ max 주문번호 사용 (length가 아닌 실제 최대 번호 — 번호 충돌 방지)
        dailyOrderCount: dailyOrders.reduce((mx, o) => {
          const m = (o.orderNumber || '').match(/-(\d+)$/);
          return m ? Math.max(mx, parseInt(m[1])) : mx;
        }, 0)
      });
      broadcastMsg({
        type: 'client_connected',
        clientType: msg.clientType,
        connectedClients: getClientSummary()
      }, clientId);

      // 주방/관리자/POS가 새로 연결되면 기존 주문 전송
      // 같은 서버 = 같은 지점이므로 branch 필터 불필요
      if ((msg.clientType === 'kitchen' || msg.clientType === 'admin' || msg.clientType === 'pos' || msg.clientType === 'customer_display') && dailyOrders.length > 0) {
        // 주방: 완료되지 않은 주문만 + skipKitchen 제외 / 관리자,POS: 전부
        const ordersToSend = (msg.clientType === 'kitchen' || msg.clientType === 'customer_display')
          ? dailyOrders.filter(o => o.status !== 'done' && o.status !== 'completed' && !o.skipKitchen)
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

      // branchCode가 없으면 서버 기본값 사용
      if (!order.branchCode) order.branchCode = BRANCH_CODE;

      // ★ 주문 저장 전 날짜 전환 체크 (자정 직후 주문이 어제 파일에 들어가는 것 방지)
      checkDateRollover();

      // ★ 서버 중앙 주문번호 발급 — POS/키오스크 번호 충돌 방지
      const prefix = order.branchCode || BRANCH_CODE;
      const existingNums = dailyOrders.map(o => {
        const m = (o.orderNumber || '').match(/-(\d+)$/);
        return m ? parseInt(m[1]) : 0;
      });
      const nextNum = (existingNums.length > 0 ? Math.max(...existingNums) : 0) + 1;
      const newOrderNumber = `${prefix}-${String(nextNum).padStart(3, '0')}`;
      if (order.orderNumber !== newOrderNumber) {
        console.log(`    🔢 주문번호 재발급: ${order.orderNumber} → ${newOrderNumber}`);
      }
      const originalOrderNumber = order.orderNumber;
      order.orderNumber = newOrderNumber;

      console.log(`  📋 [주문] ${order.orderNumber} (${BRANCH_CODE}) — £${order.total}`);
      dailyOrders.push({ ...order, receivedAt: new Date().toISOString() });
      saveOrders();

      // ★ 발신자에게 확정된 주문번호 알림 (POS 로컬 번호와 서버 번호 동기화)
      sendTo(clientId, {
        type: 'order_confirmed',
        originalOrderNumber,
        confirmedOrderNumber: newOrderNumber,
        order
      });

      // 같은 서버의 모든 클라이언트에게 전달 (같은 지점이므로 branch 필터 불필요)
      const skipKitchen = !!order.skipKitchen;
      let sentCount = 0;
      clients.forEach((c, id) => {
        if (id === clientId) return;
        if (c.type === 'kitchen') {
          if (skipKitchen) {
            console.log(`    → 주방 #${id} 건너뜀 (POS skipKitchen)`);
          } else {
            sendTo(id, { type: 'new_order', order });
            sentCount++;
            console.log(`    → 주방 #${id} 전달 완료`);
          }
        }
        if (c.type === 'admin') {
          sendTo(id, { type: 'new_order', order });
          console.log(`    → 관리자 #${id} 전달 완료`);
        }
        if (c.type === 'pos') {
          sendTo(id, { type: 'new_order', order });
          console.log(`    → POS #${id} 전달 완료`);
        }
        if (c.type === 'customer_display') {
          sendTo(id, { type: 'new_order', order });
          console.log(`    → Display #${id} 전달 완료`);
        }
      });
      if (sentCount === 0 && !skipKitchen) {
        console.log(`    ⚠️ 연결된 주방이 없음! (현재: ${[...clients.values()].map(c => c.type || '?').join(',')})`);
      }
      break;
    }

    case 'order_status': {
      console.log(`  🔄 [상태] ${msg.orderNumber} → ${msg.status}${msg.paymentStatus ? ' (pay:' + msg.paymentStatus + ')' : ''}`);
      const found = dailyOrders.find(o => o.orderNumber === msg.orderNumber);
      if (found) {
        found.status = msg.status;
        found.statusUpdatedAt = new Date().toISOString();
        if (msg.paymentStatus) found.paymentStatus = msg.paymentStatus;
        if (msg.paymentMethod) found.paymentMethod = msg.paymentMethod;
        if (msg.amountPaid !== undefined) found.amountPaid = msg.amountPaid;
        if (msg.staff) found.staff = msg.staff;
        if (msg.pickedUp) found.pickedUp = true;
        saveOrders();
      }
      // Broadcast status + full order data to all clients
      const statusMsg = {
        type: 'order_status',
        orderNumber: msg.orderNumber,
        status: msg.status
      };
      if (msg.paymentStatus) statusMsg.paymentStatus = msg.paymentStatus;
      if (msg.paymentMethod) statusMsg.paymentMethod = msg.paymentMethod;
      if (msg.pickedUp) statusMsg.pickedUp = true;
      // ★ 서버의 full order 데이터 첨부 (Kitchen이 주문을 놓쳤을 때 대비)
      if (found) statusMsg.order = found;
      broadcastMsg(statusMsg, clientId);
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
      const eodDate = msg.date || getTodayStr();
      const summary = calcDailySummary(eodDate);
      // Override with POS-provided branch info & float
      if (msg.branchCode) summary.branchCode = msg.branchCode;
      if (msg.branchName) summary.branchName = msg.branchName;
      if (msg.openingFloat !== undefined) summary.openingFloat = msg.openingFloat;

      // Send summary to POS client
      sendTo(clientId, {
        type: 'eod_summary',
        totalOrders: dailyOrders.length,
        orders: dailyOrders,
        summary: summary,
        startTime: dailyStartTime,
        endTime: new Date().toISOString()
      });

      // Save daily summary to Google Sheets (with redirect follow)
      const postData = JSON.stringify({ action: 'saveDailySummary', data: summary });
      function postToSheets(url, attempt) {
        if (attempt > 5) { sendTo(clientId, { type: 'eod_error', error: 'Too many redirects' }); return; }
        const https = require('https');
        const gUrl = new URL(url);
        const options = {
          hostname: gUrl.hostname, path: gUrl.pathname + gUrl.search,
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        };
        const gReq = https.request(options, (gRes) => {
          if (gRes.statusCode >= 300 && gRes.statusCode < 400 && gRes.headers.location) {
            // Follow redirect with GET (Google Apps Script pattern)
            const rUrl = new URL(gRes.headers.location);
            https.get(rUrl.href, (r2) => {
              let d = '';
              r2.on('data', c => d += c);
              r2.on('end', () => {
                console.log(`  ☁️  Daily summary → Google Sheets 저장 완료`);
                sendTo(clientId, { type: 'eod_complete', summary });
              });
            }).on('error', e => {
              console.log(`  ⚠️ Daily summary redirect 실패: ${e.message}`);
              sendTo(clientId, { type: 'eod_error', error: e.message });
            });
            gRes.resume();
            return;
          }
          let d = '';
          gRes.on('data', c => d += c);
          gRes.on('end', () => {
            console.log(`  ☁️  Daily summary → Google Sheets 저장 완료`);
            sendTo(clientId, { type: 'eod_complete', summary });
          });
        });
        gReq.on('error', e => {
          console.log(`  ⚠️ Daily summary 전송 실패: ${e.message}`);
          sendTo(clientId, { type: 'eod_error', error: e.message });
        });
        gReq.write(postData);
        gReq.end();
      }
      postToSheets(GOOGLE_API, 0);

      dailyOrders = [];
      dailyStartTime = new Date().toISOString();
      saveOrders();
      broadcastMsg({ type: 'day_reset', timestamp: new Date().toISOString() });
      break;
    }

    case 'delete_order': {
      const orderNum = msg.orderNumber;
      const delDate = msg.date || getTodayStr();
      console.log(`  🗑️ [삭제] 주문 ${orderNum} (${delDate})`);
      if (delDate === getTodayStr()) {
        dailyOrders = dailyOrders.filter(o => o.orderNumber !== orderNum);
        saveOrders();
      } else {
        // Past date — load, filter, save back
        const pastOrders = loadOrders(delDate).filter(o => o.orderNumber !== orderNum);
        try {
          saveOrdersForDate(delDate, pastOrders);
        } catch (e) { console.error(`  ⚠️ 과거 주문 삭제 저장 실패 (${delDate}):`, e.message); }
      }
      broadcastMsg({ type: 'order_deleted', orderNumber: orderNum, date: delDate }, clientId);
      break;
    }

    case 'refund_order': {
      const refNum = msg.orderNumber;
      const refDate = msg.date || getTodayStr();
      console.log(`  🔄 [환불] 주문 ${refNum} (${refDate}) by ${msg.refundedBy || '?'}`);
      if (refDate === getTodayStr()) {
        const order = dailyOrders.find(o => o.orderNumber === refNum);
        if (order) {
          order.refunded = true;
          order.refundedBy = msg.refundedBy || '';
          order.refundedAt = msg.refundedAt || new Date().toISOString();
          order.refundMethod = msg.refundMethod || '';
          saveOrders();
        }
      } else {
        const pastOrders = loadOrders(refDate);
        const order = pastOrders.find(o => o.orderNumber === refNum);
        if (order) {
          order.refunded = true;
          order.refundedBy = msg.refundedBy || '';
          order.refundedAt = msg.refundedAt || new Date().toISOString();
          order.refundMethod = msg.refundMethod || '';
          try { saveOrdersForDate(refDate, pastOrders); } catch (e) { console.error(`  ⚠️ 환불 저장 실패 (${refDate}):`, e.message); }
        }
      }
      broadcastMsg({ type: 'order_refunded', orderNumber: refNum, date: refDate, refundedBy: msg.refundedBy, refundedAt: msg.refundedAt, refundMethod: msg.refundMethod }, clientId);
      break;
    }

    case 'clear_orders': {
      const clearDate = msg.date || getTodayStr();
      if (clearDate === getTodayStr()) {
        console.log(`  🗑️ [전체삭제] 오늘 ${dailyOrders.length}건 삭제`);
        dailyOrders = [];
        saveOrders();
      } else {
        // Past date — overwrite with empty
        console.log(`  🗑️ [전체삭제] ${clearDate} 주문 삭제`);
        try {
          saveOrdersForDate(clearDate, []);
        } catch (e) { console.error(`  ⚠️ 과거 주문 전체삭제 실패 (${clearDate}):`, e.message); }
      }
      broadcastMsg({ type: 'orders_cleared', date: clearDate }, clientId);
      break;
    }

    case 'end_sales': {
      console.log(`  💰 [END SALES] ${msg.branchName || msg.branchCode} — Grand Total: £${(msg.grandTotal || 0).toFixed(2)}`);
      const esTimestamp = new Date().toISOString();
      const esId = `ES-${msg.branchCode}-${esTimestamp.replace(/[:.]/g, '-')}`;

      // 1. Save full END Sales record as individual file (for TBMS access)
      const fullRecord = {
        id: esId,
        timestamp: esTimestamp,
        branchCode: msg.branchCode,
        branchName: msg.branchName,
        periodFrom: msg.periodFrom,
        periodTo: msg.periodTo,
        summary: {
          totalOrders: msg.totalOrders,
          cashTotal: msg.cashTotal,
          cardTotal: msg.cardTotal,
          grandTotal: msg.grandTotal,
          cashCustomers: msg.cashCustomers,
          cardCustomers: msg.cardCustomers,
          vatTotal: msg.vatTotal,
          vatBreakdown: msg.vatBreakdown,
          cashInDrawer: 100 + (msg.cashTotal || 0)
        },
        itemBreakdown: msg.itemBreakdown || [],
        orders: msg.orders || [],
        staff: msg.staff || null
      };
      try {
        safeWriteFileSync(path.join(END_SALES_DIR, `${esId}.json`), JSON.stringify(fullRecord, null, 2));
        console.log(`  💾 END Sales full record saved: ${esId}.json`);
      } catch (e) { console.error('  ⚠️ END Sales record write failed:', e.message); }

      // 2. Append summary to end_sales_log.json (index for quick queries)
      const logPath = path.join(DATA_DIR, 'end_sales_log.json');
      let log = [];
      try { if (fs.existsSync(logPath)) log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (e) {}
      log.push({
        id: esId,
        timestamp: esTimestamp,
        branchCode: msg.branchCode, branchName: msg.branchName,
        periodFrom: msg.periodFrom, periodTo: msg.periodTo,
        totalOrders: msg.totalOrders,
        cashTotal: msg.cashTotal, cardTotal: msg.cardTotal, grandTotal: msg.grandTotal,
        cashCustomers: msg.cashCustomers, cardCustomers: msg.cardCustomers,
        vatTotal: msg.vatTotal, vatBreakdown: msg.vatBreakdown
      });
      try { safeWriteFileSync(logPath, JSON.stringify(log, null, 2)); } catch (e) { console.error('  ⚠️ end_sales_log write failed:', e.message); }

      // Save lastEndSalesAt persistently (per branch, survives reboot/day change)
      const leFilePath = path.join(DATA_DIR, 'last_end_sales.json');
      try {
        let leData = {};
        if (fs.existsSync(leFilePath)) leData = JSON.parse(fs.readFileSync(leFilePath, 'utf8'));
        leData[msg.branchCode] = msg.periodTo;
        safeWriteFileSync(leFilePath, JSON.stringify(leData, null, 2));
        console.log(`  💾 lastEndSalesAt saved for ${msg.branchCode}: ${msg.periodTo}`);
      } catch (e) { console.error('  ⚠️ last_end_sales.json write failed:', e.message); }

      // Send to Google Sheets (saveEndSales action)
      try {
        const esData = JSON.stringify({ action: 'saveEndSales', data: {
          date: new Date().toISOString().slice(0, 10),
          branchCode: msg.branchCode, branchName: msg.branchName,
          periodFrom: msg.periodFrom, periodTo: msg.periodTo,
          totalOrders: msg.totalOrders,
          cashTotal: msg.cashTotal, cardTotal: msg.cardTotal, grandTotal: msg.grandTotal,
          cashCustomers: msg.cashCustomers, cardCustomers: msg.cardCustomers,
          vatTotal: msg.vatTotal
        }});
        const https = require('https');
        const gUrl = new URL(GOOGLE_API);
        const opts = { hostname: gUrl.hostname, path: gUrl.pathname + gUrl.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(esData) } };
        const gReq = https.request(opts, (gRes) => {
          if (gRes.statusCode >= 300 && gRes.statusCode < 400 && gRes.headers.location) {
            https.get(gRes.headers.location, (r2) => { let d = ''; r2.on('data', c => d += c); r2.on('end', () => console.log('  ☁️ END Sales → Google Sheets 저장 완료')); }).on('error', e => console.warn('  ⚠️ END Sales Google redirect fail:', e.message));
            gRes.resume(); return;
          }
          let d = ''; gRes.on('data', c => d += c); gRes.on('end', () => console.log('  ☁️ END Sales → Google Sheets 저장 완료'));
        });
        gReq.on('error', e => console.warn('  ⚠️ END Sales Google 전송 실패:', e.message));
        gReq.write(esData); gReq.end();
      } catch (e) { console.warn('  ⚠️ END Sales Google Sheets error:', e.message); }

      broadcastMsg({ type: 'end_sales_completed', branchCode: msg.branchCode }, clientId);
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

  if (url === '/api/server-info') {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          ips.push({ interface: name, address: net.address });
        }
      }
    }
    const uptimeSec = Math.floor((Date.now() - new Date(SERVER_START_TIME).getTime()) / 1000);
    const wsClients = [];
    clients.forEach((c, id) => {
      wsClients.push({ id, type: c.type, branch: c.branch, connectedAt: c.connectedAt, ip: c.ip });
    });
    const dataFiles = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      serverVersion: SERVER_VERSION,
      branchCode: BRANCH_CODE,
      nodeVersion: process.version,
      platform: os.platform(),
      hostname: os.hostname(),
      arch: os.arch(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length,
      port: PORT,
      ips: ips,
      startTime: SERVER_START_TIME,
      uptimeSeconds: uptimeSec,
      connectedClients: wsClients,
      dailyOrders: dailyOrders.length,
      dataFiles: dataFiles,
    }));
    return;
  }

  // ─── Printer Config ───
  const PRINTER_CONFIG_FILE = path.join(DATA_DIR, 'printer-config.json');
  const POS_SETTINGS_FILE = path.join(DATA_DIR, 'pos-settings.json');
  const POLE_DISPLAY_CONFIG_FILE = path.join(DATA_DIR, 'pole-display.json');

  // ─── Pole Display (HP LD220 VFD) ───
  if (url === '/api/pole-display/config' && req.method === 'GET') {
    try {
      const cfg = JSON.parse(fs.readFileSync(POLE_DISPLAY_CONFIG_FILE, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cfg));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: false, port: '', baudRate: 9600, welcomeMsg: 'Welcome to The Bap!' }));
    }
    return;
  }

  if (url === '/api/pole-display/config' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        safeWriteFileSync(POLE_DISPLAY_CONFIG_FILE, JSON.stringify(cfg, null, 2));
        console.log(`  📟 Pole display config saved: ${cfg.port || 'auto'} @ ${cfg.baudRate}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url === '/api/pole-display/send' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { line1, line2 } = JSON.parse(body);
        let cfg;
        try { cfg = JSON.parse(fs.readFileSync(POLE_DISPLAY_CONFIG_FILE, 'utf8')); } catch (e) { cfg = {}; }
        if (!cfg.enabled) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, skipped: true })); return; }
        const port = cfg.port || 'COM1';
        const baud = cfg.baudRate || 9600;
        // HP LD220: 2 lines x 20 chars, ESC/POS-like protocol
        // 0x0C = clear, 0x1B40 = init, then send text
        const pad = (s, n) => (s || '').substring(0, n).padEnd(n);
        const displayText = pad(line1, 20) + pad(line2, 20);
        // Use PowerShell to send via serial port (Windows)
        const psScript = `
$port = New-Object System.IO.Ports.SerialPort '${port}', ${baud}, 'None', 8, 'One'
$port.Open()
$initBytes = [byte[]]@(0x0C)
$port.Write($initBytes, 0, $initBytes.Length)
Start-Sleep -Milliseconds 50
$textBytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes('${displayText.replace(/'/g, "''")}')
$port.Write($textBytes, 0, $textBytes.Length)
$port.Close()
`;
        const { exec } = require('child_process');
        exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, '; ').replace(/"/g, '\\"')}"`, { timeout: 5000 }, (err, stdout, stderr) => {
          if (err) {
            console.log(`  📟 Pole display error: ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          }
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (url === '/api/pole-display/detect' && req.method === 'GET') {
    // Detect available COM ports using PowerShell
    const { exec } = require('child_process');
    const psDetect = `[System.IO.Ports.SerialPort]::GetPortNames() | ForEach-Object { $_ }`;
    exec(`powershell -NoProfile -Command "${psDetect}"`, { timeout: 5000 }, (err, stdout) => {
      const ports = (stdout || '').trim().split(/\r?\n/).filter(Boolean).map(p => ({ port: p.trim(), manufacturer: '' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ports }));
    });
    return;
  }

  // ─── POS Settings (persistent) ───
  if (url === '/api/pos-settings' && req.method === 'GET') {
    try {
      const settings = fs.existsSync(POS_SETTINGS_FILE) ? JSON.parse(fs.readFileSync(POS_SETTINGS_FILE, 'utf8')) : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(settings));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    }
    return;
  }

  if (url === '/api/pos-settings' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const settings = JSON.parse(body);
        safeWriteFileSync(POS_SETTINGS_FILE, JSON.stringify(settings, null, 2));
        console.log('[POS Settings] Saved:', JSON.stringify(settings));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Cash Drawer Log ───
  const DRAWER_LOG_FILE = path.join(DATA_DIR, 'drawer-log.json');

  if (url === '/api/drawer-log' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const entry = JSON.parse(body);
        entry.serverTime = new Date().toISOString();
        let logs = [];
        try { logs = JSON.parse(fs.readFileSync(DRAWER_LOG_FILE, 'utf8')); } catch(e) {}
        logs.push(entry);
        // Keep last 500 entries
        if (logs.length > 500) logs = logs.slice(-500);
        safeWriteFileSync(DRAWER_LOG_FILE, JSON.stringify(logs, null, 2));
        console.log(`[Drawer] Log: ${entry.staff || 'unknown'} @ ${entry.branch || ''} — ${entry.reason || ''}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url === '/api/drawer-log' && req.method === 'GET') {
    try {
      const logs = fs.existsSync(DRAWER_LOG_FILE) ? JSON.parse(fs.readFileSync(DRAWER_LOG_FILE, 'utf8')) : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  if (url === '/api/printer-config' && req.method === 'GET') {
    try {
      const cfg = fs.existsSync(PRINTER_CONFIG_FILE) ? JSON.parse(fs.readFileSync(PRINTER_CONFIG_FILE, 'utf8')) : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cfg));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    }
    return;
  }

  if (url === '/api/printer-config' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        safeWriteFileSync(PRINTER_CONFIG_FILE, JSON.stringify(cfg, null, 2));
        console.log('[Printer] Config saved:', JSON.stringify(cfg));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Direct Print API ───
  if (url === '/api/print' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const cfgRaw = fs.existsSync(PRINTER_CONFIG_FILE) ? fs.readFileSync(PRINTER_CONFIG_FILE, 'utf8') : '{}';
        const cfg = JSON.parse(cfgRaw);

        console.log(`[Printer] Request: type=${data.type} | config: ip=${cfg.ip||''} device=${cfg.device||''} printerName=${cfg.printerName||''}`);

        if (!cfg.ip && !cfg.device && !cfg.printerName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Printer not configured. Go to Settings > Printer Setup.' }));
          return;
        }

        let escData = '';
        if (data.type === 'receipt') {
          const branchName = data.branchName || cfg.branchName || '';
          escData = printer.buildOrderReceipt(data.order, branchName);
          // Cash payment: prepend drawer kick command so it opens with the receipt
          if (data.openDrawer) {
            escData = printer.buildOpenDrawer() + escData;
            console.log('[Printer] Drawer kick prepended to receipt (cash payment)');
          }
        } else if (data.type === 'report') {
          escData = printer.buildReportReceipt(data.report);
        } else if (data.type === 'daily_report') {
          const d = data.data || {};
          escData = printer.buildReportReceipt({
            branchName: d.branchName || '',
            title: 'DAILY REPORT',
            from: d.periodFrom || '',
            to: d.periodTo || '',
            totalOrders: d.totalOrders || 0,
            cashCount: d.cashCustomers || 0,
            cardCount: d.cardCustomers || 0,
            cashTotal: d.cashTotal || 0,
            cardTotal: d.cardTotal || 0,
            grandTotal: d.grandTotal || 0,
            vatBreakdown: (d.vatData && d.vatData.byRate) || [],
            totalVat: (d.vatData && d.vatData.totalVat) || 0
          });
        } else if (data.type === 'open_drawer') {
          // ── Cash Drawer: sendToPrinter handles ip/device/printerName automatically ──
          escData = printer.buildOpenDrawer();
          try {
            const result = await printer.sendToPrinter(cfg, escData);
            console.log('[Printer] Drawer opened via', result.method);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, method: result.method }));
          } catch (e) {
            console.warn('[Printer] Drawer open failed:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
          return;

        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown print type: ' + data.type }));
          return;
        }

        // Print multiple copies (for receipt/report types)
        const copies = data.copies || 1;
        for (let i = 0; i < copies; i++) {
          await printer.sendToPrinter(cfg, escData);
        }

        const target = cfg.ip || cfg.device || cfg.printerName || 'unknown';
        console.log(`[Printer] ${data.type} printed (${copies}x) → ${target}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, copies, target }));
      } catch (e) {
        console.error('[Printer] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Printer Test ───
  if (url === '/api/printer-test' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        let testCfg = JSON.parse(body);
        // If no ip/device in body, use saved config
        if (!testCfg.ip && !testCfg.device && !testCfg.printerName) {
          const cfgRaw = fs.existsSync(PRINTER_CONFIG_FILE) ? fs.readFileSync(PRINTER_CONFIG_FILE, 'utf8') : '{}';
          testCfg = JSON.parse(cfgRaw);
        }
        if (!testCfg.ip && !testCfg.device && !testCfg.printerName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No printer configured. Save config first.' }));
          return;
        }
        // Build test print
        let d = printer.CMD.INIT + printer.CMD.CODEPAGE;
        d += printer.CMD.ALIGN_CENTER + printer.CMD.SIZE_DOUBLE + printer.CMD.BOLD_ON;
        d += 'PRINTER TEST' + printer.CMD.FEED;
        d += printer.CMD.SIZE_NORMAL + printer.CMD.BOLD_OFF;
        d += 'The Bap POS' + printer.CMD.FEED;
        d += printer.CMD.DASHES + printer.CMD.FEED;
        d += 'Connection: OK' + printer.CMD.FEED;
        d += `Target: ${testCfg.ip || testCfg.device || testCfg.printerName}` + printer.CMD.FEED;
        d += `Time: ${new Date().toLocaleString('en-GB')}` + printer.CMD.FEED;
        d += printer.CMD.DASHES + printer.CMD.FEED;
        d += 'Test: \xA3 symbol OK?' + printer.CMD.FEED;
        d += 'If you can read this,' + printer.CMD.FEED;
        d += 'the printer is working!' + printer.CMD.FEED;
        d += printer.CMD.FEED + printer.CMD.FEED + printer.CMD.FEED;
        d += printer.CMD.CUT;

        await printer.sendToPrinter(testCfg, d);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
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
      let allDates = [];
      files.forEach(f => {
        const name = f.replace('orders_', '').replace('.json', '');
        if (name.length === 7) {
          // 월별 파일 (orders_2026-03.json) — 안의 날짜 키들 추출
          try {
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
            allDates = allDates.concat(Object.keys(data));
          } catch (e) {}
        } else {
          // 레거시 일별 파일 (orders_2026-03-10.json)
          allDates.push(name);
        }
      });
      const dates = [...new Set(allDates)].sort().reverse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dates }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dates: [getTodayStr()] }));
    }
    return;
  }

  // ─── Orders Since (for END Sales) ───
  if (url === '/api/orders-since') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const since = urlParams.get('since'); // ISO timestamp or null
    const branch = urlParams.get('branch');
    let allOrders = [];
    try {
      const sinceDate = since ? since.slice(0, 10) : '0000-00-00';
      const sinceMonth = sinceDate.slice(0, 7);
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('orders_') && f.endsWith('.json')).sort();
      for (const f of files) {
        const name = f.replace('orders_', '').replace('.json', '');
        if (name.length === 7) {
          // 월별 파일 — 해당 월이 범위에 포함되면 날짜별 읽기
          if (name >= sinceMonth) {
            try {
              const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
              for (const [dateKey, orders] of Object.entries(data)) {
                if (dateKey >= sinceDate && dateKey !== getTodayStr()) {
                  allOrders = allOrders.concat(orders);
                }
              }
            } catch (e) {}
          }
        } else if (name.length === 10) {
          // 레거시 일별 파일
          if (name >= sinceDate && name !== getTodayStr()) {
            allOrders = allOrders.concat(loadOrders(name));
          }
        }
      }
      // 항상 오늘 메모리 주문 포함
      allOrders = allOrders.concat(dailyOrders);
    } catch (e) {
      allOrders = [...dailyOrders];
    }
    // Filter by since timestamp
    if (since) {
      const sinceTime = new Date(since).getTime();
      allOrders = allOrders.filter(o => new Date(o.timestamp).getTime() > sinceTime);
    }
    // Filter by branch
    if (branch) {
      allOrders = allOrders.filter(o => o.branchCode === branch);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(allOrders));
    return;
  }

  // ─── All Branches Summary (Admin) ───
  if (url === '/api/all-branches-summary') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const date = urlParams.get('date') || getTodayStr();
    const orders = (date === getTodayStr()) ? dailyOrders : loadOrders(date);
    const branchMap = {};
    orders.forEach(o => {
      const bc = o.branchCode || 'unknown';
      if (!branchMap[bc]) branchMap[bc] = { branchCode: bc, branchName: o.branchName || bc, totalOrders: 0, cashTotal: 0, cardTotal: 0, grandTotal: 0 };
      branchMap[bc].totalOrders++;
      const amt = o.total || 0;
      if (o.paymentMethod === 'cash') branchMap[bc].cashTotal += amt;
      else if (o.paymentMethod === 'card') branchMap[bc].cardTotal += amt;
      branchMap[bc].grandTotal += amt;
    });
    const branches = Object.values(branchMap).sort((a, b) => b.grandTotal - a.grandTotal);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ date, branches }));
    return;
  }

  // ─── END Sales Log (with optional filters: branch, from, to) ───
  // TBMS can use: /api/end-sales-log?branch=PAB&from=2026-03-01&to=2026-03-07
  if (url === '/api/end-sales-log') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const branch = urlParams.get('branch');
    const from = urlParams.get('from');
    const to = urlParams.get('to');
    const logPath = path.join(DATA_DIR, 'end_sales_log.json');
    let log = [];
    try { if (fs.existsSync(logPath)) log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (e) {}
    if (branch) log = log.filter(e => e.branchCode === branch);
    if (from) log = log.filter(e => e.timestamp >= from);
    if (to) log = log.filter(e => e.timestamp <= (to.length === 10 ? to + 'T23:59:59' : to));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(log));
    return;
  }

  // ─── END Sales Detail (full record with orders & items) ───
  // TBMS can use: /api/end-sales-detail?id=ES-PAB-2026-03-07T19-30-00-000Z
  if (url === '/api/end-sales-detail') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const id = urlParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'id parameter required' }));
      return;
    }
    const filePath = path.join(END_SALES_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'END Sales record not found' }));
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── TBMS: Branch status overview (all branches, latest END Sales, today totals) ───
  // /api/tbms/branches-status?date=2026-03-07
  if (url === '/api/tbms/branches-status') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const date = urlParams.get('date') || getTodayStr();

    // Get today's orders per branch
    const orders = (date === getTodayStr()) ? dailyOrders : loadOrders(date);
    const branchMap = {};
    orders.forEach(o => {
      const bc = o.branchCode || 'unknown';
      if (!branchMap[bc]) branchMap[bc] = { branchCode: bc, branchName: o.branchName || bc, totalOrders: 0, cashTotal: 0, cardTotal: 0, grandTotal: 0 };
      branchMap[bc].totalOrders++;
      const amt = o.total || 0;
      if (o.paymentMethod === 'cash') branchMap[bc].cashTotal += amt;
      else if (o.paymentMethod === 'card') branchMap[bc].cardTotal += amt;
      branchMap[bc].grandTotal += amt;
    });

    // Get latest END Sales per branch
    const logPath = path.join(DATA_DIR, 'end_sales_log.json');
    let log = [];
    try { if (fs.existsSync(logPath)) log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (e) {}
    const lastES = {};
    log.forEach(e => { lastES[e.branchCode] = e; });

    // Merge
    const branches = Object.keys({ ...branchMap, ...lastES }).map(bc => ({
      ...branchMap[bc] || { branchCode: bc, branchName: bc, totalOrders: 0, cashTotal: 0, cardTotal: 0, grandTotal: 0 },
      lastEndSales: lastES[bc] || null
    }));

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ date, branches }));
    return;
  }

  // ─── TBMS: Date range sales summary (aggregate by date) ───
  // /api/tbms/sales-summary?branch=PAB&from=2026-03-01&to=2026-03-07
  if (url === '/api/tbms/sales-summary') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const branch = urlParams.get('branch');
    const from = urlParams.get('from') || getTodayStr();
    const to = urlParams.get('to') || getTodayStr();

    const dayMap = {};
    let d = new Date(from);
    const end = new Date(to);
    while (d <= end) {
      const ds = d.toISOString().slice(0, 10);
      const orders = (ds === getTodayStr()) ? dailyOrders : loadOrders(ds);
      const filtered = branch ? orders.filter(o => o.branchCode === branch) : orders;
      if (filtered.length > 0) {
        dayMap[ds] = {
          date: ds,
          totalOrders: filtered.length,
          cashTotal: filtered.filter(o => o.paymentMethod === 'cash').reduce((s, o) => s + (o.total || 0), 0),
          cardTotal: filtered.filter(o => o.paymentMethod === 'card').reduce((s, o) => s + (o.total || 0), 0),
          grandTotal: filtered.reduce((s, o) => s + (o.total || 0), 0)
        };
      }
      d.setDate(d.getDate() + 1);
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ branch: branch || 'all', from, to, days: Object.values(dayMap) }));
    return;
  }

  // ─── Last END Sales (persistent per branch) ───
  if (url === '/api/last-end-sales' && req.method === 'GET') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const branch = urlParams.get('branch');
    const filePath = path.join(DATA_DIR, 'last_end_sales.json');
    let data = {};
    try { if (fs.existsSync(filePath)) data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ lastEndSalesAt: (branch && data[branch]) || null }));
    return;
  }
  if (url === '/api/last-end-sales' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { branch, lastEndSalesAt } = JSON.parse(body);
        const filePath = path.join(DATA_DIR, 'last_end_sales.json');
        let data = {};
        try { if (fs.existsSync(filePath)) data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
        data[branch] = lastEndSalesAt;
        safeWriteFileSync(filePath, JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url === '/api/ip') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip: LOCAL_IP, port: PORT, wsUrl: `ws://${LOCAL_IP}:${PORT}` }));
    return;
  }

  // ─── Register (Cash Till) API ───
  if (url === '/api/register' && req.method === 'GET') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const dateStr = urlParams.get('date') || getTodayStr();
    const reg = loadRegister(dateStr);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ date: dateStr, register: reg }));
    return;
  }

  if (url === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        data.date = data.date || getTodayStr();
        data.updatedAt = new Date().toISOString();
        saveRegister(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Critical Operation: Refund via HTTP (crash-safe fallback) ───
  if (url === '/api/refund' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const refNum = msg.orderNumber;
        const refDate = msg.date || getTodayStr();
        console.log(`  🔄 [HTTP환불] ${refNum} (${refDate}) by ${msg.refundedBy || '?'} ${msg.refundMethod || ''}`);
        let found = false;
        if (refDate === getTodayStr()) {
          const order = dailyOrders.find(o => o.orderNumber === refNum);
          if (order) {
            order.refunded = true;
            order.refundedBy = msg.refundedBy || '';
            order.refundedAt = msg.refundedAt || new Date().toISOString();
            order.refundMethod = msg.refundMethod || '';
            saveOrders();
            found = true;
          }
        } else {
          const pastOrders = loadOrders(refDate);
          const order = pastOrders.find(o => o.orderNumber === refNum);
          if (order) {
            order.refunded = true;
            order.refundedBy = msg.refundedBy || '';
            order.refundedAt = msg.refundedAt || new Date().toISOString();
            order.refundMethod = msg.refundMethod || '';
            saveOrdersForDate(refDate, pastOrders);
            found = true;
          }
        }
        broadcastAll({ type: 'order_refunded', orderNumber: refNum, date: refDate, refundedBy: msg.refundedBy, refundedAt: msg.refundedAt, refundMethod: msg.refundMethod });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, found }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Critical Operation: Update order status via HTTP (payment etc.) ───
  if (url === '/api/order-status' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const found = dailyOrders.find(o => o.orderNumber === msg.orderNumber);
        if (found) {
          if (msg.status) found.status = msg.status;
          if (msg.paymentStatus) found.paymentStatus = msg.paymentStatus;
          if (msg.paymentMethod) found.paymentMethod = msg.paymentMethod;
          if (msg.amountPaid !== undefined) found.amountPaid = msg.amountPaid;
          if (msg.change !== undefined) found.change = msg.change;
          saveOrders();
          broadcastAll({ type: 'order_status', ...msg });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, found: !!found }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Sync POS state from client (recovery endpoint) ───
  if (url === '/api/sync-orders' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const clientOrders = msg.orders || [];
        let merged = 0;
        clientOrders.forEach(co => {
          if (!co.orderNumber) return;
          const existing = dailyOrders.find(o => o.orderNumber === co.orderNumber);
          if (!existing) {
            dailyOrders.push(co);
            merged++;
          } else {
            // Merge refund/payment status if client has newer data
            if (co.refunded && !existing.refunded) {
              existing.refunded = co.refunded;
              existing.refundedBy = co.refundedBy;
              existing.refundedAt = co.refundedAt;
              existing.refundMethod = co.refundMethod;
              merged++;
            }
            if (co.paymentStatus === 'paid' && existing.paymentStatus !== 'paid') {
              existing.paymentStatus = co.paymentStatus;
              existing.paymentMethod = co.paymentMethod;
              merged++;
            }
          }
        });
        if (merged > 0) saveOrders();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, merged, totalOnServer: dailyOrders.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Daily Summary API ───
  if (url === '/api/daily-summary') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const dateStr = urlParams.get('date') || getTodayStr();
    const summary = calcDailySummary(dateStr);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
    return;
  }

  // ─── Export API (date range) ───
  if (url === '/api/export') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const from = urlParams.get('from');
    const to = urlParams.get('to') || getTodayStr();
    try {
      // 모든 날짜 수집 (월별 + 레거시)
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('orders_') && f.endsWith('.json'));
      let allDates = [];
      files.forEach(f => {
        const name = f.replace('orders_', '').replace('.json', '');
        if (name.length === 7) {
          try { allDates = allDates.concat(Object.keys(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')))); } catch (e) {}
        } else allDates.push(name);
      });
      const dates = [...new Set(allDates)].filter(d => (!from || d >= from) && d <= to).sort();
      const result = [];
      dates.forEach(d => {
        const orders = (d === getTodayStr()) ? dailyOrders : loadOrders(d);
        const reg = loadRegister(d);
        result.push({ date: d, orders, register: reg, summary: calcDailySummary(d) });
      });
      result.sort((a, b) => a.date.localeCompare(b.date));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ from: from || result[0]?.date, to, days: result }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
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

  // ─── Cash Drawer API ───
  if (url === '/api/cashdrawer' && req.method === 'POST') {
    // ESC/POS command to open cash drawer: ESC p 0 25 250
    // Pin 2 kick: 0x1B 0x70 0x00 0x19 0xFA
    const drawerCmd = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
    try {
      // Try writing to common POS printer devices
      const printerPaths = ['/dev/usb/lp0', '/dev/usb/lp1', '/dev/lp0'];
      let opened = false;
      for (const pp of printerPaths) {
        try {
          fs.writeFileSync(pp, drawerCmd);
          console.log(`  💰 Cash drawer opened via ${pp}`);
          opened = true;
          break;
        } catch (e) { /* try next */ }
      }
      if (!opened) {
        // Fallback: try network printer if configured
        const printerIP = process.env.TB_PRINTER_IP;
        const printerPort = parseInt(process.env.TB_PRINTER_PORT || '9100');
        if (printerIP) {
          const net = require('net');
          const sock = new net.Socket();
          sock.connect(printerPort, printerIP, () => {
            sock.write(drawerCmd);
            sock.end();
            console.log(`  💰 Cash drawer opened via ${printerIP}:${printerPort}`);
          });
          sock.on('error', (e) => console.warn('  ⚠️ Printer socket error:', e.message));
        } else {
          console.log('  ℹ️ Cash drawer: no printer device found (set TB_PRINTER_IP for network printer)');
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      console.error('  ⚠️ Cash drawer error:', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
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
          if (src.branches) menuCache.branches = src.branches;
          if (src.branchVisibility) menuCache.branchVisibility = src.branchVisibility;
          if (src.allergens) menuCache.allergens = src.allergens;
          if (src.nutrition) menuCache.nutrition = src.nutrition;
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

        // Google Sheets에도 동기화 (설정된 경우) — 디바운스로 중복 방지
        if (GOOGLE_MENU_API && action !== 'syncFromGoogle') {
          debouncedSyncMenuToGoogle(menuCache);
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
<span class="url">📺 손님: http://${LOCAL_IP}:${PORT}/display</span>
<span class="url">🔧 진단: http://${LOCAL_IP}:${PORT}/test</span></div></div>
<script>setInterval(()=>{fetch('/api/health').then(r=>r.json()).then(d=>{
document.getElementById('cl').textContent='주문:'+d.clients.order+' 주방:'+d.clients.kitchen+' POS:'+d.clients.pos+' 손님:'+(d.clients.customer_display||0)+' 관리:'+d.clients.admin;
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
  console.log(`  ║   🍚  TBOrder Server v${SERVER_VERSION} (ws + Stripe)`.padEnd(55) + '║');
  console.log('  ║   The Bap (더밥) Kiosk System                    ║');
  console.log(`  ║   🏪  Branch: ${BRANCH_CODE}`.padEnd(55) + '║');
  console.log(`  ║   💳  Stripe: ${stripe ? '✅ Active' : '❌ Not configured'}`.padEnd(55) + '║');
  console.log('  ║                                                  ║');
  console.log(`  ║   📡  IP:   ${LOCAL_IP.padEnd(36)}║`);
  console.log(`  ║   🌐  Port: ${String(PORT).padEnd(36)}║`);
  console.log('  ║                                                  ║');
  console.log(`  ║   🖥️  주문:  http://${LOCAL_IP}:${PORT}/order`.padEnd(55) + '║');
  console.log(`  ║   🍳  주방:  http://${LOCAL_IP}:${PORT}/kitchen`.padEnd(55) + '║');
  console.log(`  ║   ⚙️  관리:  http://${LOCAL_IP}:${PORT}/admin`.padEnd(55) + '║');
  console.log(`  ║   💰  POS:   http://${LOCAL_IP}:${PORT}/pos`.padEnd(55) + '║');
  console.log(`  ║   📺  손님:  http://${LOCAL_IP}:${PORT}/display`.padEnd(55) + '║');
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
