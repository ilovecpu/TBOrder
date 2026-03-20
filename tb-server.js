#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════
 *  🍚 The Bap (더밥) — TBOrder Local Server v4.4.5
 *  Last Updated: 2026-03-19
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
let BRANCH_CODE = process.env.TB_BRANCH || 'TB';   // 지점코드: POS 등록 시 자동 업데이트됨
let BRANCH_NAME = '';                                // POS 등록 시 자동 업데이트됨
let _branchReady = false;                            // ★ POS 로그인 완료 후 true — false면 TBMS 푸시 안함
let _cashReportPct = 100;                            // ★ POS에서 설정한 Cash Report % (SUB 계산용)
let _dailyPushTime = '23:50';                        // ★ POS에서 설정한 Daily Push 시간 (HH:MM)
let _vatPct = 20;                                    // ★ POS에서 설정한 VAT 비율 (0-100%)
const SERVER_VERSION = '4.4.5';

// ════════════════════════════════════════════════════════════
//  ★ Last Session Restore — 마지막 로그인 세션 저장/복원 (v4.4.0)
//  서버 재시작 시 (특히 오프라인) 마지막 로그인 상태 즉시 복원
// ════════════════════════════════════════════════════════════
const LAST_SESSION_FILE = path.join(__dirname, 'data', 'last-session.json');

function saveLastSession() {
  try {
    const session = {
      branchCode: BRANCH_CODE,
      branchName: BRANCH_NAME,
      cashReportPct: _cashReportPct,
      vatPct: _vatPct,
      dailyPushTime: _dailyPushTime,
      allBranches: global._tbAllBranches || [],
      savedAt: new Date().toISOString()
    };
    safeWriteFileSync(LAST_SESSION_FILE, JSON.stringify(session, null, 2));
    console.log(`  💾 [Session] 세션 저장: ${BRANCH_CODE} (${BRANCH_NAME})`);
  } catch (e) {
    console.warn(`  ⚠️ [Session] 저장 실패: ${e.message}`);
  }
}

function restoreLastSession() {
  try {
    if (!fs.existsSync(LAST_SESSION_FILE)) return false;
    const session = JSON.parse(fs.readFileSync(LAST_SESSION_FILE, 'utf8'));
    if (!session.branchCode || session.branchCode === 'TB') return false;
    BRANCH_CODE = session.branchCode;
    BRANCH_NAME = session.branchName || '';
    _cashReportPct = session.cashReportPct || 100;
    _vatPct = session.vatPct != null ? session.vatPct : 20;
    _dailyPushTime = session.dailyPushTime || '23:50';
    if (session.allBranches) global._tbAllBranches = session.allBranches;
    _branchReady = true;  // ★ 복원된 세션으로 즉시 운영 가능
    const age = Math.round((Date.now() - new Date(session.savedAt).getTime()) / 60000);
    console.log(`  ♻️  [Session] 복원: ${BRANCH_CODE} (${BRANCH_NAME}) — ${age}분 전 세션`);
    console.log(`     cashPct=${_cashReportPct}% vatPct=${_vatPct}% pushTime=${_dailyPushTime}`);
    return true;
  } catch (e) {
    console.warn(`  ⚠️ [Session] 복원 실패: ${e.message}`);
    return false;
  }
}

// 서버 시작 시 마지막 세션 복원 시도
restoreLastSession();
const SERVER_START_TIME = new Date().toISOString();
const GOOGLE_MENU_API = process.env.GOOGLE_MENU_API || 'https://script.google.com/macros/s/AKfycbyRtWRXXRJFR5EYLy4E4H2h5NRohMJyWZX_epjCdymIseT9npaviRaOJRKX7gwOqM-foA/exec';
const GOOGLE_API = process.env.GOOGLE_API || 'https://script.google.com/macros/s/AKfycbyRtWRXXRJFR5EYLy4E4H2h5NRohMJyWZX_epjCdymIseT9npaviRaOJRKX7gwOqM-foA/exec';

// ════════════════════════════════════════════════════════════
//  ★ Internet Connectivity Monitor — 오프라인 대응 (v4.4.0)
//  인터넷 끊김 → 로컬 캐시로 운영, 복구 시 자동 동기화
// ════════════════════════════════════════════════════════════
let _isOnline = true;                     // 현재 인터넷 연결 상태
let _lastOnlineTime = new Date();         // 마지막으로 온라인이었던 시각
let _lastOfflineTime = null;              // 오프라인 시작 시각
let _connectivityCheckCount = 0;          // 연속 실패 횟수
const CONNECTIVITY_CHECK_INTERVAL = 30000; // 30초마다 체크
const CONNECTIVITY_FAIL_THRESHOLD = 2;     // 2회 연속 실패 시 오프라인 판정

// DNS lookup으로 인터넷 연결 체크 (가벼움, Google DNS)
function checkInternet() {
  return new Promise((resolve) => {
    const dns = require('dns');
    dns.lookup('script.google.com', (err) => {
      resolve(!err);
    });
  });
}

async function _connectivityLoop() {
  const wasOnline = _isOnline;
  const reachable = await checkInternet();

  if (reachable) {
    _connectivityCheckCount = 0;
    if (!_isOnline) {
      // ★ 오프라인 → 온라인 복구!
      _isOnline = true;
      _lastOnlineTime = new Date();
      const downtime = _lastOfflineTime ? Math.round((Date.now() - _lastOfflineTime.getTime()) / 1000) : 0;
      console.log(`  🌐 [NET] 인터넷 복구! (다운타임: ${downtime}초)`);
      _onReconnect();
    }
  } else {
    _connectivityCheckCount++;
    if (_connectivityCheckCount >= CONNECTIVITY_FAIL_THRESHOLD && _isOnline) {
      // ★ 온라인 → 오프라인 전환
      _isOnline = false;
      _lastOfflineTime = new Date();
      console.log(`  ⚡ [NET] 인터넷 연결 끊김! — 오프라인 모드 진입 (로컬 캐시로 운영)`);
      // 클라이언트들에게 오프라인 알림
      _broadcastToClients({ type: 'connectivity', online: false, since: _lastOfflineTime.toISOString() });
    }
  }
}

// 인터넷 복구 시 실행할 작업들
async function _onReconnect() {
  console.log(`  🔄 [NET] 복구 동기화 시작...`);
  // 클라이언트들에게 온라인 알림
  _broadcastToClients({ type: 'connectivity', online: true, since: _lastOnlineTime.toISOString() });

  // 1) 메뉴 동기화 (3초 후)
  setTimeout(() => {
    console.log(`  🔄 [NET] 메뉴 동기화 재개`);
    syncMenuFromGoogle();
  }, 3000);

  // 2) 브랜치 동기화 (5초 후)
  setTimeout(() => {
    console.log(`  🔄 [NET] 브랜치 동기화 재개`);
    syncBranchesFromTBMS();
  }, 5000);

  // 3) 대기 중인 SalesOrders 큐 플러시 (8초 후)
  setTimeout(() => {
    if (orderPushQueue.length > 0) {
      console.log(`  🔄 [NET] 대기 큐 플러시: ${orderPushQueue.length}건`);
      flushOrderQueue();
    }
  }, 8000);

  // 4) dirty 메뉴가 있으면 업로드 (10초 후)
  setTimeout(() => {
    if (_localMenuDirty) {
      console.log(`  🔄 [NET] 로컬 메뉴 변경 업로드 재개`);
      debouncedSyncMenuToGoogle(menuCache);
    }
  }, 10000);

  // 5) 대기 중인 End Sales 재전송 (12초 후)
  setTimeout(() => { _retryPendingEndSales(); }, 12000);
}

// ─── Pending End Sales: 오프라인 시 저장, 복구 시 재전송 ───
const PENDING_ES_DIR = path.join(__dirname, 'data', 'pending_end_sales');

function _savePendingEndSales(esId, msg) {
  try {
    if (!fs.existsSync(PENDING_ES_DIR)) fs.mkdirSync(PENDING_ES_DIR, { recursive: true });
    safeWriteFileSync(path.join(PENDING_ES_DIR, `${esId}.json`), JSON.stringify(msg));
  } catch (e) { console.warn(`  ⚠️ [PendingES] 저장 실패: ${e.message}`); }
}

async function _retryPendingEndSales() {
  try {
    if (!fs.existsSync(PENDING_ES_DIR)) return;
    const files = fs.readdirSync(PENDING_ES_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) return;
    console.log(`  🔄 [NET] 대기 End Sales 재전송: ${files.length}건`);
    for (const file of files) {
      try {
        const msg = JSON.parse(fs.readFileSync(path.join(PENDING_ES_DIR, file), 'utf8'));
        const esId = file.replace('.json', '');
        await pushEndSalesToTBMS(msg, esId);
        // 성공 시 pending 파일 삭제
        fs.unlinkSync(path.join(PENDING_ES_DIR, file));
        console.log(`  ✅ [PendingES] 재전송 성공: ${esId}`);
      } catch (e) {
        console.warn(`  ⚠️ [PendingES] 재전송 실패 (다음 복구 시 재시도): ${file} — ${e.message}`);
      }
    }
  } catch (e) { console.warn(`  ⚠️ [PendingES] 재전송 오류: ${e.message}`); }
}

// ★ WebSocket 브로드캐스트 헬퍼 (connectivity에서 사용)
function _broadcastToClients(msgObj) {
  const data = JSON.stringify(msgObj);
  clients.forEach((c) => {
    try { if (c.ws && c.ws.readyState === 1) c.ws.send(data); } catch (e) { /* ignore */ }
  });
}

// 30초마다 연결 체크 시작
setInterval(_connectivityLoop, CONNECTIVITY_CHECK_INTERVAL);
// 서버 시작 5초 후 첫 체크
setTimeout(_connectivityLoop, 5000);

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
  if (!_isOnline) { /* 오프라인 — 캐시로 운영 */ return; }
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
  if (!_isOnline) { console.log('  ⚡ [NET] 오프라인 — 메뉴 업로드 대기'); return; }
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
  if (!_isOnline) { /* 오프라인 — 캐시로 운영 */ return; }
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
  setInterval(syncMenuFromGoogle, 1 * 60 * 1000);  // 1분마다 Google Sheets 동기화 (기존 5분)
  setInterval(syncBranchesFromTBMS, 10 * 60 * 1000); // 10분마다 브랜치 동기화
}

// ════════════════════════════════════════════════════════════
//  ★ TBMS Sales Data Push — 자동 푸시 (Daily/Live/EndSales)
//  Branch server → TBMS Apps Script → Google Sheets → TBMS.html
// ════════════════════════════════════════════════════════════
const TBMS_API = process.env.TBMS_API || 'https://script.google.com/macros/s/AKfycbz_0Vcn1aCQyHZ7i9XRFp72f6O1H5kAsuaFATW4MMSnOhgWakAjMebH8ngMchYDHfS5/exec';
const TBMS_API_KEY = 'tBaP2026xKr!mGt9Qz';

// ─── Generic POST to TBMS Apps Script (with redirect follow) ───
function pushToTBMS(data) {
  if (!_isOnline) return Promise.reject(new Error('OFFLINE — 인터넷 연결 없음'));
  return new Promise((resolve, reject) => {
    const postBody = JSON.stringify({ ...data, apikey: TBMS_API_KEY });
    const https = require('https');
    const gUrl = new URL(TBMS_API);
    const opts = {
      hostname: gUrl.hostname, path: gUrl.pathname + gUrl.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postBody) },
      timeout: 30000 // ★ S09: 30초 타임아웃
    };
    const gReq = https.request(opts, (gRes) => {
      if (gRes.statusCode >= 300 && gRes.statusCode < 400 && gRes.headers.location) {
        // Google Apps Script redirects POST → GET
        https.get(gRes.headers.location, { timeout: 30000 }, (r2) => {
          let d = ''; r2.on('data', c => d += c);
          r2.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
        }).on('error', reject);
        gRes.resume(); return;
      }
      let d = ''; gRes.on('data', c => d += c);
      gRes.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    });
    gReq.on('timeout', () => { gReq.destroy(new Error('TBMS API timeout (30s)')); });
    gReq.on('error', reject);
    gReq.write(postBody); gReq.end();
  });
}

// ─── Build Dual Summary from orders (Main + Sub) on server side ───
function buildServerDualSummary(orders) {
  const paid = orders.filter(o => o.paymentStatus === 'paid' && !o.refunded);
  const cashOrders = paid.filter(o => o.paymentMethod === 'cash');
  const cardOrders = paid.filter(o => o.paymentMethod === 'card');

  // ★ MAIN: 100% actual sales + Main VAT
  const mainCash = cashOrders.reduce((s, o) => s + (o.total || 0), 0);
  const mainCard = cardOrders.reduce((s, o) => s + (o.total || 0), 0);
  const mainGrand = mainCash + mainCard;
  // Main VAT: use per-order mainVat if available, else estimate from items
  let mainVatTotal = 0;
  const mainVatByRate = {};
  paid.forEach(o => {
    if (o.mainVat !== undefined) {
      mainVatTotal += o.mainVat;
      // Group by primary rate (20% default)
      const rate = '20'; // simplified — actual rate grouping from items
      if (!mainVatByRate[rate]) mainVatByRate[rate] = { net: 0, vat: 0, gross: 0 };
      mainVatByRate[rate].vat += o.mainVat;
      mainVatByRate[rate].gross += o.total || 0;
      mainVatByRate[rate].net += (o.total || 0) - o.mainVat;
    } else {
      // Fallback: calc from items
      (o.items || []).forEach(it => {
        const rate = String(it.vatRate || 20);
        const gross = it.free ? 0 : (it.totalPrice || 0);
        const vat = rate > 0 ? gross - gross / (1 + Number(rate) / 100) : 0;
        if (!mainVatByRate[rate]) mainVatByRate[rate] = { net: 0, vat: 0, gross: 0 };
        mainVatByRate[rate].gross += gross;
        mainVatByRate[rate].vat += vat;
        mainVatByRate[rate].net += gross - vat;
        mainVatTotal += vat;
      });
    }
  });

  // ★ SUB: Card 100% + Cash reduced by cashPct% + VATable% 기반 VAT
  const cashPct = _cashReportPct !== 100 ? _cashReportPct : (paid[0]?.subCashPct || 100);
  const vatablePct = _vatPct != null ? _vatPct : 20;
  const mainVatRate = 20; // UK standard VAT rate
  const subCash = Math.round(mainCash * (cashPct / 100) * 100) / 100;
  const subCard = mainCard;
  const subGrand = Math.round((subCash + subCard) * 100) / 100;
  // VATable / Non-VATable split
  const vatableGross = Math.round(subGrand * (vatablePct / 100) * 100) / 100;
  const nonVatableGross = Math.round((subGrand - vatableGross) * 100) / 100;
  const subVatTotal = Math.round((vatableGross - vatableGross / (1 + mainVatRate / 100)) * 100) / 100;
  const subTotalNet = Math.round((subGrand - subVatTotal) * 100) / 100;

  return {
    totalOrders: paid.length,
    cashCount: cashOrders.length,
    cardCount: cardOrders.length,
    main: {
      cashTotal: Math.round(mainCash * 100) / 100,
      cardTotal: Math.round(mainCard * 100) / 100,
      grandTotal: Math.round(mainGrand * 100) / 100,
      vatTotal: Math.round(mainVatTotal * 100) / 100,
      vatBreakdown: mainVatByRate
    },
    sub: {
      cashPct,
      vatablePct,
      vatRate: mainVatRate,
      cashTotal: subCash,
      cardTotal: Math.round(subCard * 100) / 100,
      grandTotal: subGrand,
      vatableGross,
      nonVatableGross,
      vatTotal: subVatTotal,
      totalNet: subTotalNet
    }
  };
}

// ─── Build Item Breakdown for push ───
function buildItemBreakdown(orders) {
  const map = {};
  orders.filter(o => o.paymentStatus === 'paid' && !o.refunded).forEach(o => {
    (o.items || []).forEach(it => {
      const key = it.nameEn || it.name || 'Unknown';
      if (!map[key]) map[key] = { name: key, qty: 0, total: 0, vatRate: it.vatRate || 20 };
      map[key].qty += it.quantity || 1;
      map[key].total += it.free ? 0 : (it.totalPrice || 0);
    });
  });
  return Object.values(map);
}

// ─── Daily Push Log (전송 기록 — 서버 재시작 후에도 유지) ───
// DATA_DIR는 서버 시작 후 초기화되므로 lazy 접근
function _dailyPushLogPath() { return path.join(DATA_DIR, 'daily_push_log.json'); }
function getDailyPushLog() {
  try { const p = _dailyPushLogPath(); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}; } catch (e) { return {}; }
}
function markDailyPushed(dateStr) {
  try {
    const log = getDailyPushLog();
    log[dateStr] = new Date().toISOString();
    // 최근 30일만 보관
    const keys = Object.keys(log).sort().slice(-30);
    const trimmed = {}; keys.forEach(k => trimmed[k] = log[k]);
    safeWriteFileSync(_dailyPushLogPath(), JSON.stringify(trimmed, null, 2));
  } catch (e) { console.warn('[DailyPushLog] save failed:', e.message); }
}
function wasDailyPushed(dateStr) {
  return !!getDailyPushLog()[dateStr];
}

// ─── A) Daily Push (설정 시간 자동 푸시 + 보완 푸시) ───
async function pushDailySalesToTBMS(targetDate) {
  if (!TBMS_API) return;
  if (!_branchReady) { console.log('  📊 [TBMS] Daily push 스킵 — POS 미로그인 (_branchReady=false)'); return; }
  try {
    const dateStr = targetDate || getTodayStr();
    // 이미 전송된 날짜면 스킵
    if (wasDailyPushed(dateStr)) { console.log(`  📊 [TBMS] Daily push 스킵 — ${dateStr} 이미 전송됨`); return; }
    const orders = (!targetDate && dailyOrders.length > 0) ? dailyOrders : loadOrders(dateStr);
    if (orders.length === 0) { console.log(`  📊 [TBMS] No orders for ${dateStr}, skip daily push`); return; }
    const dual = buildServerDualSummary(orders);
    const branchName = BRANCH_NAME || orders[0]?.branchName || BRANCH_CODE;
    const result = await pushToTBMS({
      action: 'pushDailySales',
      date: dateStr,
      branch: BRANCH_CODE,
      branchName,
      totalOrders: dual.totalOrders,
      main: dual.main,
      sub: dual.sub,
      cashCount: dual.cashCount,
      cardCount: dual.cardCount,
      itemBreakdown: buildItemBreakdown(orders)
    });
    markDailyPushed(dateStr);
    console.log(`  📊 [TBMS] Daily push (${dateStr}): ${result.status || 'done'} — £${dual.main.grandTotal}`);
  } catch (e) {
    console.warn(`  ⚠️ [TBMS] Daily push failed: ${e.message}`);
  }
}

// ─── 보완 푸시: 어제 데이터가 전송 안 됐으면 자동 전송 ───
async function catchUpDailyPush() {
  if (!TBMS_API || !_branchReady) return;
  // 어제 날짜 체크
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDateStr = yesterday.toISOString().slice(0, 10);
  if (!wasDailyPushed(yDateStr)) {
    console.log(`  📊 [TBMS] 보완 푸시 — 어제(${yDateStr}) 데이터 미전송, 지금 전송합니다`);
    await pushDailySalesToTBMS(yDateStr);
  }
}

// ─── B) Hourly Live Push (매시간 라이브 푸시) ───
async function pushLiveSalesToTBMS() {
  if (!TBMS_API) return;
  if (!_branchReady) { console.log('  📊 [TBMS] Live push 스킵 — POS 미로그인 (_branchReady=false)'); return; }
  try {
    const today = getTodayStr();
    const orders = dailyOrders; // current day in memory
    if (orders.length === 0) return; // no orders yet today
    const dual = buildServerDualSummary(orders);
    const branchName = orders[0]?.branchName || BRANCH_NAME || BRANCH_CODE;
    const result = await pushToTBMS({
      action: 'pushLiveSales',
      date: today,
      branch: BRANCH_CODE,
      branchName,
      main_grandTotal: dual.main.grandTotal,
      main_vatTotal: dual.main.vatTotal,
      main_cashTotal: dual.main.cashTotal,
      main_cardTotal: dual.main.cardTotal,
      sub_grandTotal: dual.sub.grandTotal,
      sub_vatTotal: dual.sub.vatTotal,
      sub_vatablePct: dual.sub.vatablePct,
      sub_vatableGross: dual.sub.vatableGross,
      sub_nonVatableGross: dual.sub.nonVatableGross,
      sub_totalNet: dual.sub.totalNet,
      sub_cashTotal: dual.sub.cashTotal,
      sub_cardTotal: dual.sub.cardTotal,
      totalOrders: dual.totalOrders,
      cashCount: dual.cashCount,
      cardCount: dual.cardCount
    });
    console.log(`  📊 [TBMS] Live push: ${dual.totalOrders} orders, £${dual.main.grandTotal}`);
  } catch (e) {
    console.warn(`  ⚠️ [TBMS] Live push failed: ${e.message}`);
  }
}

// ─── C) END Sales Push (엔드세일즈 이벤트 푸시) ───
async function pushEndSalesToTBMS(msg, esId) {
  if (!TBMS_API) return;
  try {
    const result = await pushToTBMS({
      action: 'pushEndSales',
      id: esId,
      branch: msg.branchCode,
      branchName: msg.branchName,
      periodFrom: msg.periodFrom,
      periodTo: msg.periodTo,
      totalOrders: msg.totalOrders,
      cashCount: msg.cashCustomers || 0,
      cardCount: msg.cardCustomers || 0,
      main: {
        cashTotal: msg.cashTotal, cardTotal: msg.cardTotal,
        grandTotal: msg.grandTotal, vatTotal: msg.vatTotal
      },
      sub: msg.sub || { cashPct: 100, grandTotal: msg.grandTotal, vatTotal: msg.vatTotal },
      itemBreakdown: msg.itemBreakdown || [],
      staff: msg.staff
    });
    console.log(`  📊 [TBMS] END Sales push: ${esId} → ${result.status || 'done'}`);
  } catch (e) {
    console.warn(`  ⚠️ [TBMS] END Sales push failed: ${e.message}`);
  }
}

// ─── Schedule automatic pushes ───
if (TBMS_API) {
  console.log(`  📊 TBMS Sales Push 활성화 (${BRANCH_CODE})`);

  // ★ SalesOrders: 5분마다 배치 푸시 (v4.3.1: 지점별 stagger로 동시 쓰기 방지)
  // BRANCH_CODE 해시 → 0~60초 오프셋 → 10지점이어도 시트 동시 접근 최소화
  const _staggerMs = (function() {
    var h = 0;
    for (var i = 0; i < BRANCH_CODE.length; i++) h = ((h << 5) - h + BRANCH_CODE.charCodeAt(i)) | 0;
    return (Math.abs(h) % 60) * 1000; // 0~59초
  })();
  console.log(`  ⏱️  Push stagger offset: ${_staggerMs/1000}s (${BRANCH_CODE})`);
  setTimeout(() => flushOrderQueue(), 120000 + _staggerMs); // 서버 시작 2분+오프셋 후 첫 플러시
  setInterval(() => flushOrderQueue(), 5 * 60 * 1000); // 5분마다

  // NOTE: pushDailySalesToTBMS / pushLiveSalesToTBMS 자동 스케줄 제거 (v4.2.2)
  //   → TBMS Live Today가 SalesOrders 기반 getSalesOrdersSummary로 대체됨
  //   → DailySales/LiveSales 시트는 더이상 사용하지 않음
}

// ═══════════════════════════════════════════════════════════
//  ★ SalesOrders Queue — 개별 주문 데이터 배치 푸시
//  메모리 큐 + 디스크 백업 (정전/크래시 대비)
// ═══════════════════════════════════════════════════════════
const ORDER_QUEUE_FILE = path.join(__dirname, 'data', 'order_push_queue.json');
const MAX_QUEUE_SIZE = 10000; // ★ 큐 무한 증가 방지
let orderPushQueue = []; // 메모리 큐
let _flushingQueue = false; // 중복 플러시 방지

// ─── 큐 디스크 백업 로드 (서버 시작 시) ───
function loadOrderQueue() {
  try {
    if (fs.existsSync(ORDER_QUEUE_FILE)) {
      orderPushQueue = JSON.parse(fs.readFileSync(ORDER_QUEUE_FILE, 'utf8'));
      if (orderPushQueue.length > 0) {
        console.log(`  📦 [SalesOrders] 큐 복원: ${orderPushQueue.length}건`);
      }
    }
  } catch (e) {
    console.warn(`  ⚠️ [SalesOrders] 큐 파일 로드 실패: ${e.message}`);
    orderPushQueue = [];
  }
}

// ─── 큐 디스크 저장 ───
function saveOrderQueue() {
  try {
    safeWriteFileSync(ORDER_QUEUE_FILE, JSON.stringify(orderPushQueue));
  } catch (e) {
    console.warn(`  ⚠️ [SalesOrders] 큐 파일 저장 실패: ${e.message}`);
  }
}

// ─── 주문을 큐에 추가 (skipSave=true면 디스크 저장 생략 — 대량작업 후 수동 save) ───
function queueOrderForPush(order, skipSave) {
  if (!TBMS_API || !order || !order.orderNumber) return;
  const dateStr = order.timestamp ? order.timestamp.slice(0, 10) : getTodayStr();
  const branch = order.branchCode || BRANCH_CODE;
  const id = `${branch}_${order.orderNumber}_${dateStr}`;

  // 중복 방지: 같은 id가 이미 큐에 있으면 업데이트
  const existIdx = orderPushQueue.findIndex(q => q.id === id);
  const entry = {
    id,
    branch,
    branchName: BRANCH_NAME || branch,
    orderNumber: order.orderNumber,
    timestamp: order.timestamp || new Date().toISOString(),
    date: dateStr,
    orderType: order.orderType || '',
    paymentMethod: order.paymentMethod || '',
    total: order.total || 0,
    itemCount: (order.items || []).reduce((s, i) => s + (i.quantity || 1), 0),
    items: (order.items || []).map(i => ({
      name: i.nameEn || i.name,
      qty: i.quantity || 1,
      price: i.totalPrice || (i.price * (i.quantity || 1)),
      vatRate: i.vatRate
    })),
    refunded: !!order.refunded,
    refundedBy: order.refundedBy || '',
    refundedAt: order.refundedAt || '',
    refundMethod: order.refundMethod || '',
    vat: order.mainVat || 0,
    cashPct: _cashReportPct,       // ★ POS 설정값 — SUB 계산용
    vatablePct: _vatPct,           // ★ POS 설정값 — SUB VAT 계산용
    pushedAt: new Date().toISOString()
  };

  if (existIdx >= 0) {
    orderPushQueue[existIdx] = entry;
  } else {
    orderPushQueue.push(entry);
  }
  // ★ 큐 사이즈 제한: 오래된 항목 제거
  if (orderPushQueue.length > MAX_QUEUE_SIZE) {
    const trimmed = orderPushQueue.length - MAX_QUEUE_SIZE;
    orderPushQueue = orderPushQueue.slice(trimmed);
    console.warn(`  ⚠️ [SalesOrders] 큐 초과 — ${trimmed}건 오래된 항목 제거`);
  }
  if (!skipSave) saveOrderQueue(); // 개별 주문: 즉시 저장. 대량: 마지막에 한번만
}

// ─── 배치 플러시 (1회: 최대 50건) ───
async function flushOrderQueue() {
  if (!TBMS_API || _flushingQueue || orderPushQueue.length === 0) return;
  if (!_isOnline) { console.log(`  ⚡ [SalesOrders] 오프라인 — 큐 대기 중 (${orderPushQueue.length}건), 복구 시 자동 전송`); return; }
  _flushingQueue = true;

  const batchSize = 50;
  const batch = orderPushQueue.slice(0, batchSize);

  try {
    console.log(`  📤 [SalesOrders] 배치 푸시: ${batch.length}건 (큐 잔여: ${orderPushQueue.length}건)`);
    const result = await pushToTBMS({
      action: 'pushSalesOrders',
      orders: batch
    });

    if (result && result.status === 'ok' && result.processedIds) {
      const processedSet = new Set(result.processedIds);
      orderPushQueue = orderPushQueue.filter(q => !processedSet.has(q.id));
      saveOrderQueue();
      console.log(`  ✅ [SalesOrders] 푸시 완료: ${result.inserted}건 추가, ${result.updated}건 업데이트, 큐 잔여: ${orderPushQueue.length}건`);
    } else {
      console.warn(`  ⚠️ [SalesOrders] 푸시 응답 이상:`, JSON.stringify(result).slice(0, 200));
    }
  } catch (e) {
    console.warn(`  ⚠️ [SalesOrders] 푸시 실패 (재시도 예정): ${e.message}`);
  } finally {
    _flushingQueue = false;
  }
}

// ─── 전체 큐 플러시 (50건씩 반복, 큐가 빌 때까지) ───
// 수동 PUSH NOW, END Sales 시 사용
async function flushOrderQueueAll() {
  if (!TBMS_API || orderPushQueue.length === 0) return;
  let rounds = 0;
  const maxRounds = 20; // 안전장치: 최대 1000건 (20×50)
  while (orderPushQueue.length > 0 && rounds < maxRounds) {
    await flushOrderQueue();
    rounds++;
    // flushOrderQueue가 실패해서 큐가 안 줄면 무한루프 방지
    if (_flushingQueue) break; // 이미 다른 곳에서 플러시 중
  }
  if (rounds >= maxRounds && orderPushQueue.length > 0) {
    console.warn(`  ⚠️ [SalesOrders] 최대 라운드(${maxRounds}) 도달, 잔여: ${orderPushQueue.length}건`);
  }
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

// ─── POS Settings 초기 로드 (dailyPushTime, cashReportPct, vatPct) ───
try {
  const _posSettingsPath = path.join(DATA_DIR, 'pos-settings.json');
  if (fs.existsSync(_posSettingsPath)) {
    const _saved = JSON.parse(fs.readFileSync(_posSettingsPath, 'utf8'));
    if (_saved.dailyPushTime) { _dailyPushTime = _saved.dailyPushTime; }
    if (_saved.cashReportPct) { _cashReportPct = Number(_saved.cashReportPct) || 100; }
    if (_saved.vatPct != null) { _vatPct = Number(_saved.vatPct); }
    console.log(`  ⚙️  POS Settings loaded: pushTime=${_dailyPushTime}, cashPct=${_cashReportPct}%, vatPct=${_vatPct}%`);
  }
} catch (e) { console.warn('[POS Settings] init load failed:', e.message); }

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

// ★ SalesOrders 큐 복원 (정전/재시작 대비)
loadOrderQueue();

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
async function handleMessage(clientId, rawData) {
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
      // ★ POS에서 보낸 branchCode가 있으면 서버 BRANCH_CODE 자동 업데이트
      if (msg.branchCode && msg.clientType === 'pos') {
        const oldCode = BRANCH_CODE;
        BRANCH_CODE = msg.branchCode;
        BRANCH_NAME = msg.branchName || msg.branchCode;
        if (oldCode !== BRANCH_CODE) {
          console.log(`  🏪 BRANCH_CODE 자동 변경: ${oldCode} → ${BRANCH_CODE} (${BRANCH_NAME})`);
        }
      }
      client.branch = BRANCH_CODE;
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

    // ★ POS 로그인 후 지점 전체 정보 수신 — BRANCH_CODE/NAME 확정 업데이트
    case 'set_branch': {
      if (msg.branchCode) {
        const oldCode = BRANCH_CODE;
        BRANCH_CODE = msg.branchCode;
        BRANCH_NAME = msg.branchName || msg.branchCode;
        _branchReady = true;  // ★ POS 로그인 확정 → TBMS 푸시 활성화
        // ★ POS에서 보낸 Cash Report % 저장
        if (msg.cashReportPct != null) {
          _cashReportPct = Number(msg.cashReportPct) || 100;
          console.log(`  💰 Cash Report %: ${_cashReportPct}%`);
        }
        // ★ POS에서 보낸 Daily Push Time 저장
        if (msg.dailyPushTime) {
          _dailyPushTime = msg.dailyPushTime;
          console.log(`  ⏰ Daily Push Time: ${_dailyPushTime}`);
        }
        // ★ POS에서 보낸 VAT % 저장
        if (msg.vatPct != null) {
          _vatPct = Number(msg.vatPct);
          console.log(`  🧾 VAT %: ${_vatPct}%`);
        }
        if (oldCode !== BRANCH_CODE) {
          console.log(`  🏪 BRANCH 확정: ${oldCode} → ${BRANCH_CODE} (${BRANCH_NAME}) — TBMS 푸시 활성화`);
        } else {
          console.log(`  🏪 BRANCH 확인: ${BRANCH_CODE} (${BRANCH_NAME}) — TBMS 푸시 활성화`);
        }
        // 전체 지점 목록 저장 (다른 기능에서 활용 가능)
        if (msg.allBranches && Array.isArray(msg.allBranches)) {
          global._tbAllBranches = msg.allBranches;
          console.log(`     All branches: ${msg.allBranches.map(b => b.code).join(', ')}`);
        }
        // ★ 로그인 세션 디스크 저장 (오프라인 복원용)
        saveLastSession();
        // ★ POS 로그인 시 보완 푸시 — 어제 데이터 미전송이면 자동 전송
        setTimeout(() => catchUpDailyPush(), 10000); // 10초 후 (안정화 대기)
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
      const savedOrder = { ...order, receivedAt: new Date().toISOString() };
      dailyOrders.push(savedOrder);
      saveOrders();

      // ★ SalesOrders: 이미 결제 완료된 주문은 즉시 큐에 추가 (POS completePayment 등)
      if (order.paymentStatus === 'paid') {
        queueOrderForPush(savedOrder);
      }

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
        // ★ SalesOrders: 결제 완료 시 큐에 추가
        if (msg.paymentStatus === 'paid') {
          queueOrderForPush(found);
        }
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
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
          timeout: 30000 // ★ S09: 30초 타임아웃
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
        // Past date — load, update, save back
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
      // ★ v4.4.4: 리펀드된 주문을 SalesOrders 큐에 다시 넣어 Google Sheets 업데이트
      {
        const refOrder = (refDate === getTodayStr() ? dailyOrders : loadOrders(refDate)).find(o => o.orderNumber === refNum);
        if (refOrder) {
          queueOrderForPush(refOrder);
          flushOrderQueue();
          console.log(`  📤 [WS Refund→SalesOrders] ${refNum} 리펀드 상태 큐에 추가`);
        }
      }
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
        // ★ SUB 데이터 (Cash% 적용)
        sub: msg.sub || null,
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

      // ★ 온라인이면 즉시 전송, 오프라인이면 pending 파일 저장 후 복구 시 재전송
      if (_isOnline) {
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
          const opts = { hostname: gUrl.hostname, path: gUrl.pathname + gUrl.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(esData) }, timeout: 30000 };
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
        // Push to TBMS
        try { await pushEndSalesToTBMS(msg, esId); } catch(e) { console.warn('  ⚠️ TBMS EndSales push error:', e.message); }
        // SalesOrders 큐 플러시
        try { await flushOrderQueueAll(); } catch(e) { console.warn('  ⚠️ SalesOrders flush error:', e.message); }
      } else {
        // ★ 오프라인: pending_end_sales에 저장 → 복구 시 _onReconnect에서 재전송
        _savePendingEndSales(esId, msg);
        console.log(`  ⚡ [END Sales] 오프라인 — pending 저장 완료 (${esId}), 복구 시 자동 전송`);
      }

      broadcastMsg({ type: 'end_sales_completed', branchCode: msg.branchCode }, clientId);
      break;
    }

    case 'ping': {
      sendTo(clientId, { type: 'pong', timestamp: Date.now() });
      break;
    }

    // ★ SalesOrders: 수동 푸시 & 큐 상태 조회 (개발/디버그용)
    case 'flush_sales_orders': {
      const queueLen = orderPushQueue.length;
      if (queueLen === 0) {
        sendTo(clientId, { type: 'flush_sales_orders_result', status: 'empty', message: '큐가 비어있습니다 (푸시할 데이터 없음)', queueLength: 0 });
      } else {
        sendTo(clientId, { type: 'flush_sales_orders_result', status: 'flushing', message: `${queueLen}건 푸시 시작...`, queueLength: queueLen });
        try {
          await flushOrderQueueAll();
          sendTo(clientId, { type: 'flush_sales_orders_result', status: 'ok', message: `${queueLen}건 중 ${queueLen - orderPushQueue.length}건 푸시 완료! 잔여: ${orderPushQueue.length}건`, queueLength: orderPushQueue.length });
        } catch (e) {
          sendTo(clientId, { type: 'flush_sales_orders_result', status: 'error', message: `푸시 실패: ${e.message}`, queueLength: orderPushQueue.length });
        }
      }
      break;
    }

    case 'get_sales_orders_queue': {
      sendTo(clientId, {
        type: 'sales_orders_queue_status',
        queueLength: orderPushQueue.length,
        items: orderPushQueue.slice(0, 10).map(q => ({ id: q.id, total: q.total, date: q.date, orderType: q.orderType })),
        hasMore: orderPushQueue.length > 10
      });
      break;
    }

    // ★ 기존 주문 데이터를 큐에 재등록 (날짜 범위 지정 가능)
    case 'requeue_orders': {
      const dateFrom = msg.from || getTodayStr();
      const dateTo = msg.to || getTodayStr();
      let totalQueued = 0;

      // 날짜 범위 순회 — skipSave=true로 디스크 I/O 최소화
      const start = new Date(dateFrom);
      const end = new Date(dateTo);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const orders = loadOrders(dateStr);
        const paidOrders = orders.filter(o => o.paymentStatus === 'paid');
        paidOrders.forEach(o => {
          queueOrderForPush(o, true); // skipSave — 대량이니 디스크 쓰기 생략
          totalQueued++;
        });
      }
      saveOrderQueue(); // ★ 마지막에 한 번만 저장

      sendTo(clientId, {
        type: 'requeue_orders_result',
        status: 'ok',
        message: `${dateFrom}~${dateTo} 기간 ${totalQueued}건 큐에 등록 완료`,
        totalQueued,
        queueLength: orderPushQueue.length
      });
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

  // ─── 이미지 프록시 + 로컬 캐시 (v4.4.0: 오프라인 대응) ───
  // /api/img?id=GOOGLE_FILE_ID → lh3 CDN에서 다운 → data/img_cache/ 저장 → 반환
  if (url === '/api/img') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const fileId = params.get('id');
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
      res.writeHead(400); res.end('Bad id'); return;
    }
    const cacheDir = path.join(DATA_DIR, 'img_cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const cachePath = path.join(cacheDir, fileId + '.jpg');

    // 1) 캐시 있으면 즉시 반환
    if (fs.existsSync(cachePath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(cachePath).pipe(res);
      return;
    }
    // 2) 온라인이면 다운로드 + 캐시 + 반환
    if (_isOnline) {
      const https = require('https');
      const imgUrl = `https://lh3.googleusercontent.com/d/${fileId}=w400`;
      https.get(imgUrl, { timeout: 10000 }, (imgRes) => {
        if (imgRes.statusCode === 200) {
          const chunks = [];
          imgRes.on('data', c => chunks.push(c));
          imgRes.on('end', () => {
            const buf = Buffer.concat(chunks);
            try { fs.writeFileSync(cachePath, buf); } catch(e) {}
            res.writeHead(200, { 'Content-Type': imgRes.headers['content-type'] || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
            res.end(buf);
          });
        } else {
          res.writeHead(imgRes.statusCode || 404); res.end();
        }
      }).on('error', () => { res.writeHead(502); res.end(); });
      return;
    }
    // 3) 오프라인 + 캐시 없음 → 404
    res.writeHead(404); res.end('Offline, no cache');
    return;
  }

  // ─── REST API ───
  // ★ v4.4.3: Staff + 오프라인 데이터 저장/서빙 API
  // Staff 데이터: TBMS에서 가져온 걸 서버에 저장 → 오프라인 시 파일에서 서빙
  // ★ v4.4.4: 지점별 Staff 저장/로드
  if (url === '/api/branch-staff' && req.method === 'GET') {
    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const qBranch = urlParams.get('branch') || '';
    // 지점별 파일 우선, 없으면 공통 파일
    const branchFile = qBranch ? path.join(DATA_DIR, `branch_staff_${qBranch}.json`) : '';
    const genericFile = path.join(DATA_DIR, 'branch_staff.json');
    const staffFile = (branchFile && fs.existsSync(branchFile)) ? branchFile : genericFile;
    try {
      if (fs.existsSync(staffFile)) {
        const data = JSON.parse(fs.readFileSync(staffFile, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ staff: data.staff || [], source: 'file', savedAt: data.savedAt, branchCode: data.branchCode || '' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ staff: [], source: 'none' }));
      }
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ staff: [], source: 'error', error: e.message }));
    }
    return;
  }
  if (url === '/api/branch-staff' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { staff, branchCode } = JSON.parse(body);
        const bc = branchCode || BRANCH_CODE || 'unknown';
        // 지점별 파일 + 공통 파일 둘 다 저장
        const branchFile = path.join(DATA_DIR, `branch_staff_${bc}.json`);
        const genericFile = path.join(DATA_DIR, 'branch_staff.json');
        const payload = JSON.stringify({ staff: staff || [], savedAt: new Date().toISOString(), branchCode: bc });
        safeWriteFileSync(branchFile, payload);
        safeWriteFileSync(genericFile, payload);
        console.log(`  👥 [Staff] ${bc}: ${(staff || []).length}명 저장 완료`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: (staff || []).length, branchCode: bc }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // 오프라인 데이터 일괄 저장/로딩 API (POS 로그인/PIN users 등)
  if (url === '/api/offline-data' && req.method === 'GET') {
    const result = {};
    // Staff
    try { const sf = path.join(DATA_DIR, 'branch_staff.json'); if (fs.existsSync(sf)) result.staff = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch(e) {}
    // PIN Users (POS user list)
    try { const pf = path.join(DATA_DIR, 'pin_users.json'); if (fs.existsSync(pf)) result.pinUsers = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch(e) {}
    // Branches (phone 포함 → 지점 PIN 체크용)
    try { const bf = path.join(DATA_DIR, 'branches.json'); if (fs.existsSync(bf)) result.branches = JSON.parse(fs.readFileSync(bf, 'utf8')); } catch(e) {}
    // Last session
    try { if (fs.existsSync(LAST_SESSION_FILE)) result.lastSession = JSON.parse(fs.readFileSync(LAST_SESSION_FILE, 'utf8')); } catch(e) {}
    // ★ v4.4.4: Session (지점/직원)
    try { const sf = path.join(DATA_DIR, 'session.json'); if (fs.existsSync(sf)) result.session = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch(e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }
  if (url === '/api/offline-data' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        // Staff
        if (data.staff) {
          safeWriteFileSync(path.join(DATA_DIR, 'branch_staff.json'), JSON.stringify({ staff: data.staff, savedAt: new Date().toISOString(), branchCode: BRANCH_CODE }));
          console.log(`  👥 [Offline] Staff ${data.staff.length}명 저장`);
        }
        // PIN Users
        if (data.pinUsers) {
          safeWriteFileSync(path.join(DATA_DIR, 'pin_users.json'), JSON.stringify({ users: data.pinUsers, savedAt: new Date().toISOString() }));
          console.log(`  🔑 [Offline] PIN Users ${data.pinUsers.length}명 저장`);
        }
        // Branches (phone 포함)
        if (data.branches) {
          safeWriteFileSync(path.join(DATA_DIR, 'branches.json'), JSON.stringify({ branches: data.branches, savedAt: new Date().toISOString() }));
          console.log(`  🏪 [Offline] Branches ${data.branches.length}개 저장`);
        }
        // ★ v4.4.4: Session (지점/직원 세션 정보)
        if (data.session) {
          safeWriteFileSync(path.join(DATA_DIR, 'session.json'), JSON.stringify({ ...data.session, savedAt: new Date().toISOString() }));
          console.log(`  📋 [Offline] Session 저장: ${data.session.branch} — ${data.session.branchName}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

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
      connectivity: {
        online: _isOnline,
        lastOnline: _lastOnlineTime.toISOString(),
        lastOffline: _lastOfflineTime ? _lastOfflineTime.toISOString() : null,
        queuePending: orderPushQueue.length
      }
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
        // ★ v4.4.4: enabled 체크 제거 — 포트 설정되어 있으면 항상 전송
        const port = cfg.port || 'COM3';
        const baud = cfg.baudRate || 9600;
        // HP LD220: 2 lines x 20 chars
        const pad = (s, n) => (s || '').substring(0, n).padEnd(n);
        const L1 = pad(line1, 20);
        const L2 = pad(line2, 20);
        // ★ v4.4.4: Clear + overwrite 방식 (0x0C로 화면 클리어 후 40자 전송)
        // £ 기호: JavaScript \xA3 → CP437 0x9C 변환
        const safeLine = (s) => (s || '').replace(/£/g, '\x9C').substring(0, 20).padEnd(20);
        const sL1 = safeLine(L1);
        const sL2 = safeLine(L2);
        // Build hex byte array string for PowerShell (avoid encoding issues)
        const toHexBytes = (str) => {
            const bytes = [];
            for (let i = 0; i < str.length; i++) {
                bytes.push('0x' + str.charCodeAt(i).toString(16).toUpperCase().padStart(2, '0'));
            }
            return bytes.join(',');
        };
        const hexL1 = toHexBytes(sL1);
        const hexL2 = toHexBytes(sL2);
        const psScript = `
$ErrorActionPreference = 'Stop'
$log = @()
try {
    $log += "Opening ${port} at ${baud}bps..."
    $sp = New-Object System.IO.Ports.SerialPort
    $sp.PortName = '${port}'
    $sp.BaudRate = ${baud}
    $sp.Parity = [System.IO.Ports.Parity]::None
    $sp.DataBits = 8
    $sp.StopBits = [System.IO.Ports.StopBits]::One
    $sp.Handshake = [System.IO.Ports.Handshake]::None
    $sp.DtrEnable = $true
    $sp.RtsEnable = $true
    $sp.WriteTimeout = 2000
    $sp.Open()
    Start-Sleep -Milliseconds 100

    # ★ v4.4.4: Clear (0x0C) → 40바이트 연속 (CR+LF 없이 자동 줄넘김)
    $b1 = [byte[]]@(${hexL1})
    $b2 = [byte[]]@(${hexL2})
    # 0x0C(clear+home) + Line1(20) + Line2(20) = 41 bytes
    $allBytes = [byte[]]@(0x0C) + $b1 + $b2
    $sp.Write($allBytes, 0, $allBytes.Length)
    $log += "Sent: $($allBytes.Length) bytes (clear+40chars)"

    Start-Sleep -Milliseconds 50
    $sp.Close()
    $log += "OK"
    Write-Output ("OK|" + ($log -join ';'))
} catch {
    $log += "ERROR: $_"
    if ($sp -and $sp.IsOpen) { try { $sp.Close() } catch {} }
    Write-Output ("FAIL|" + ($log -join ';'))
    exit 1
}
`;
        const psFile = path.join(DATA_DIR, '_pole_cmd.ps1');
        fs.writeFileSync(psFile, psScript);
        const { exec } = require('child_process');
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 10000 }, (err, stdout, stderr) => {
          const raw = (stdout || '').trim();
          const parts = raw.split('|');
          const status = parts[0] || '';
          const logs = (parts[1] || '').split(';').filter(Boolean);
          const errMsg = err ? (stderr || err.message) : '';
          console.log(`  📟 Pole [${port}] status=${status} logs=${JSON.stringify(logs)} err=${errMsg}`);
          if (status === 'OK') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, port, baud, logs }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: errMsg || raw, port, baud, logs }));
          }
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ★ v4.4.2: Pole display 진단 테스트 엔드포인트
  if (url === '/api/pole-display/test' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { port: testPort } = JSON.parse(body || '{}');
        const portName = testPort || 'COM3';
        // 3가지 프로토콜로 순차 테스트
        const psScript = `
$ErrorActionPreference = 'Stop'
$results = @()

function Test-VFD($portName, $method, $bytes) {
    try {
        $sp = New-Object System.IO.Ports.SerialPort $portName, 9600, 'None', 8, 'One'
        $sp.Handshake = [System.IO.Ports.Handshake]::None
        $sp.DtrEnable = $true
        $sp.RtsEnable = $true
        $sp.WriteTimeout = 2000
        $sp.Open()
        Start-Sleep -Milliseconds 200
        $sp.Write($bytes, 0, $bytes.Length)
        Start-Sleep -Milliseconds 300
        $sp.Close()
        return "$method=OK"
    } catch {
        if ($sp -and $sp.IsOpen) { try { $sp.Close() } catch {} }
        return "$method=ERROR:$_"
    }
}

# Test 1: 0x0C clear + ASCII text
$enc = [System.Text.Encoding]::GetEncoding(437)
$t1 = [byte[]]@(0x0C) + $enc.GetBytes("==== TEST 1 ====    HP LD220 POLE OK  ")
$results += Test-VFD '${portName}' 'FF_CLEAR' $t1
Start-Sleep -Milliseconds 1000

# Test 2: ESC @ init + 0x0C clear + text
$t2 = [byte[]]@(0x1B, 0x40, 0x0C) + $enc.GetBytes("==== TEST 2 ====    ESC@ INIT+CLEAR   ")
$results += Test-VFD '${portName}' 'ESC@_FF' $t2
Start-Sleep -Milliseconds 1000

# Test 3: ESC @ + overwrite mode (0x1B 0x11) + text
$t3 = [byte[]]@(0x1B, 0x40, 0x1B, 0x11) + $enc.GetBytes("==== TEST 3 ====    OVERWRITE MODE    ")
$results += Test-VFD '${portName}' 'ESC@_OVR' $t3
Start-Sleep -Milliseconds 1000

# Test 4: Just raw text (no init, no clear) with CR LF
$t4 = $enc.GetBytes("==== TEST 4 ====") + [byte[]]@(0x0D, 0x0A) + $enc.GetBytes("RAW TEXT + CRLF ")
$results += Test-VFD '${portName}' 'RAW_CRLF' $t4

Write-Output ($results -join '|')
`;
        const psFile = path.join(DATA_DIR, '_pole_test.ps1');
        fs.writeFileSync(psFile, psScript);
        const { exec } = require('child_process');
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 30000 }, (err, stdout, stderr) => {
          const raw = (stdout || '').trim();
          const results = raw.split('|').filter(Boolean);
          console.log(`  📟 Pole TEST [${portName}]: ${JSON.stringify(results)}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ port: portName, results, raw, error: err ? (stderr || err.message) : null }));
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url === '/api/pole-display/detect' && req.method === 'GET') {
    // ★ v4.4.1: Detect COM ports + test open each port (DTR/RTS enabled)
    const { exec } = require('child_process');
    const psDetect = `
$ports = [System.IO.Ports.SerialPort]::GetPortNames()
foreach ($p in $ports) {
    $status = 'found'
    try {
        $sp = New-Object System.IO.Ports.SerialPort $p, 9600, 'None', 8, 'One'
        $sp.DtrEnable = $true
        $sp.RtsEnable = $true
        $sp.ReadTimeout = 500
        $sp.WriteTimeout = 500
        $sp.Open()
        Start-Sleep -Milliseconds 100
        $sp.Close()
        $status = 'ok'
    } catch {
        $status = "error: $_"
    }
    Write-Output "$p|$status"
}
`;
    const psFile = path.join(DATA_DIR, '_pole_detect.ps1');
    fs.writeFileSync(psFile, psDetect);
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 8000 }, (err, stdout) => {
      const lines = (stdout || '').trim().split(/\r?\n/).filter(Boolean);
      const ports = lines.map(l => {
        const [port, ...rest] = l.split('|');
        return { port: (port || '').trim(), status: (rest.join('|') || '').trim() };
      });
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
          escData = printer.buildOrderReceipt(data.order, branchName, data.vatNo || '');
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
            totalVat: (d.vatData && d.vatData.totalVat) || 0,
            vatNo: d.vatNo || ''
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

  // ─── Manual Daily Push to TBMS ───
  if (url === '/api/tbms-daily-push' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { date, force } = JSON.parse(body || '{}');
        const dateStr = date || getTodayStr();
        if (!TBMS_API) { res.writeHead(400, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({error:'TBMS API not configured'})); return; }
        if (!_branchReady) { res.writeHead(400, hJSON); res.end(JSON.stringify({error:'POS not logged in (branch not ready)'})); return; }
        // force=true 면 중복 체크 무시
        if (!force && wasDailyPushed(dateStr)) { res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({status:'already_pushed', date: dateStr})); return; }
        const orders = (dateStr === getTodayStr() && dailyOrders.length > 0) ? dailyOrders : loadOrders(dateStr);
        if (orders.length === 0) { res.writeHead(200, hJSON); res.end(JSON.stringify({status:'no_orders', date: dateStr})); return; }
        const dual = buildServerDualSummary(orders);
        const branchName = BRANCH_NAME || orders[0]?.branchName || BRANCH_CODE;
        const result = await pushToTBMS({
          action: 'pushDailySales',
          date: dateStr,
          branch: BRANCH_CODE,
          branchName,
          totalOrders: dual.totalOrders,
          main: dual.main,
          sub: dual.sub,
          cashCount: dual.cashCount,
          cardCount: dual.cardCount,
          itemBreakdown: buildItemBreakdown(orders)
        });
        markDailyPushed(dateStr);
        console.log(`  📊 [TBMS] Manual push (${dateStr}): ${result.status || 'done'} — £${dual.main.grandTotal}`);
        res.writeHead(200, hJSON);
        res.end(JSON.stringify({status:'pushed', date: dateStr, orders: orders.length, total: dual.main.grandTotal}));
      } catch (e) {
        console.warn(`  ⚠️ [TBMS] Manual push failed: ${e.message}`);
        res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }

  // ─── Manual EndSales Push to TBMS (단건) ───
  if (url === '/api/tbms-endsales-push' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body || '{}');
        if (!id) { res.writeHead(400, hJSON); res.end(JSON.stringify({error:'id required'})); return; }
        if (!TBMS_API) { res.writeHead(400, hJSON); res.end(JSON.stringify({error:'TBMS API not configured'})); return; }
        // Load the EndSales detail file
        const filePath = path.join(END_SALES_DIR, `${id}.json`);
        if (!fs.existsSync(filePath)) { res.writeHead(404, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({error:'EndSales record not found'})); return; }
        const rec = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const s = rec.summary || {};
        const sub = rec.sub || null;
        const result = await pushToTBMS({
          action: 'pushEndSales',
          id: rec.id,
          branch: rec.branchCode,
          branchName: rec.branchName,
          periodFrom: rec.periodFrom,
          periodTo: rec.periodTo,
          totalOrders: s.totalOrders || 0,
          cashCount: s.cashCustomers || 0,
          cardCount: s.cardCustomers || 0,
          main: {
            cashTotal: s.cashTotal || 0, cardTotal: s.cardTotal || 0,
            grandTotal: s.grandTotal || 0, vatTotal: s.vatTotal || 0
          },
          sub: sub || { cashPct: 100, grandTotal: s.grandTotal || 0, vatTotal: s.vatTotal || 0 },
          itemBreakdown: rec.itemBreakdown || [],
          staff: rec.staff
        });
        console.log(`  📊 [TBMS] Manual EndSales push: ${id} → ${result.status || 'done'}`);
        res.writeHead(200, hJSON);
        res.end(JSON.stringify({status:'pushed', id, result: result.status || 'done'}));
      } catch (e) {
        console.warn(`  ⚠️ [TBMS] Manual EndSales push failed: ${e.message}`);
        res.writeHead(500, hJSON);
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }

  // ─── END Sales Delete ───
  if (url === '/api/end-sales-delete' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id, timestamp } = JSON.parse(body);
        if (!id && !timestamp) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'id or timestamp required'})); return; }
        // 1. Delete detail file (if id exists)
        if (id) {
          const filePath = path.join(END_SALES_DIR, `${id}.json`);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        // 2. Remove from log — match by id OR timestamp
        const logPath = path.join(DATA_DIR, 'end_sales_log.json');
        try {
          if (fs.existsSync(logPath)) {
            let log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
            const before = log.length;
            if (id) {
              log = log.filter(e => e.id !== id);
            } else if (timestamp) {
              log = log.filter(e => e.timestamp !== timestamp);
            }
            safeWriteFileSync(logPath, JSON.stringify(log, null, 2));
            console.log(`  🗑️ END Sales log: ${before - log.length} record(s) removed`);
          }
        } catch (e) { console.warn('[EndSales] log cleanup error:', e.message); }
        console.log(`  🗑️ END Sales record deleted: ${id || timestamp}`);
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({success:true, deleted: id || timestamp}));
      } catch (e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error: e.message}));
      }
    });
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

  // ─── [DEPRECATED v4.2.2] TBMS Live Push — SalesOrders로 대체됨 ───
  if (url === '/api/tbms-push-live' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deprecated: true, message: 'Live push replaced by SalesOrders queue. Use flush_sales_orders instead.' }));
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
        // ★ v4.4.4: 리펀드된 주문을 SalesOrders 큐에 다시 넣어 Google Sheets 업데이트
        if (found) {
          const refOrder = (refDate === getTodayStr() ? dailyOrders : loadOrders(refDate)).find(o => o.orderNumber === refNum);
          if (refOrder) {
            queueOrderForPush(refOrder);
            flushOrderQueue(); // 즉시 푸시
            console.log(`  📤 [Refund→SalesOrders] ${refNum} 리펀드 상태 큐에 추가`);
          }
        }
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

const MAX_CLIENTS = 50; // ★ S07: 동시 접속 제한 (DoS 방지)
const MAX_MSG_SIZE = 512 * 1024; // ★ S08: 메시지 최대 크기 512KB

wss.on('connection', (ws, req) => {
  // ★ S07: 연결 수 제한
  if (clients.size >= MAX_CLIENTS) {
    console.warn(`  ⚠️ 최대 연결 수 초과 (${clients.size}/${MAX_CLIENTS}) — 거부`);
    ws.close(1013, 'Server too busy');
    return;
  }
  const clientId = ++clientIdCounter;
  const remoteIP = req.socket.remoteAddress || '?';
  clients.set(clientId, { ws, type: null, branch: '', connectedAt: new Date().toISOString(), ip: remoteIP });
  console.log(`  🔌 클라이언트 연결 #${clientId} (IP: ${remoteIP}, 총 ${clients.size}대)`);

  ws.on('message', (data) => {
    try {
      const rawData = typeof data === 'string' ? data : data.toString('utf8');
      // ★ S08: 메시지 크기 제한
      if (rawData.length > MAX_MSG_SIZE) {
        console.warn(`  ⚠️ 메시지 크기 초과 #${clientId}: ${(rawData.length/1024).toFixed(1)}KB > ${MAX_MSG_SIZE/1024}KB`);
        return;
      }
      handleMessage(clientId, rawData);
    } catch (e) {
      console.error(`  ⚠️ 메시지 처리 오류 #${clientId}:`, e.message);
    }
  });

  ws.on('close', (code, reason) => {
    const c = clients.get(clientId);
    clients.delete(clientId);
    console.log(`  ❌ 연결 해제 #${clientId} (${c?.type || '?'}) code=${code} (남은: ${clients.size}대)`);
    // ★ POS 연결 해제 시 — 남은 POS가 없으면 TBMS 푸시 비활성화
    if (c?.type === 'pos') {
      const remainingPOS = [...clients.values()].filter(cl => cl.type === 'pos');
      if (remainingPOS.length === 0) {
        _branchReady = false;
        BRANCH_NAME = '';
        _cashReportPct = 100;
        console.log('  🔴 POS 전부 연결 해제 → _branchReady=false, TBMS 푸시 비활성화');
      }
    }
    broadcastMsg({ type: 'client_disconnected', connectedClients: getClientSummary() });
  });

  ws.on('error', (err) => {
    console.error(`  ⚠️ WebSocket 오류 #${clientId}:`, err.message);
    clients.delete(clientId);
  });

  // Ping/Pong keep-alive (30초마다) + ★ dead client detection
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; }); // 내장 pong (binary ping 응답)

  const pingInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) { clearInterval(pingInterval); return; }
    if (!ws.isAlive) {
      // 이전 ping에 pong 응답 없음 → dead client
      console.log(`  💀 Dead client 감지 #${clientId} — 강제 종료`);
      ws.terminate();
      clearInterval(pingInterval);
      return;
    }
    ws.isAlive = false;
    ws.ping();
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
  console.error('  🔥 [uncaughtException]:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('  🔥 [unhandledRejection]:', reason);
});
