/**
 * ════════════════════════════════════════════════════════════
 *  🍚 The Bap — Google Apps Script v2.0
 *  Menu API + Orders + Image Upload + TBMS Stores + Users + DailySales
 *  + Branches, BranchVisibility, Allergens, Nutrition
 *  Last Updated: 2026-03-10
 * ════════════════════════════════════════════════════════════
 *
 *  설정 방법:
 *  1. Google Sheets 새로 만들기
 *  2. Extensions > Apps Script 클릭
 *  3. 이 코드 전체 복사 → 붙여넣기
 *  4. 메뉴에서 initializeSheets 함수 실행 (처음 한번)
 *  5. Deploy > New deployment > Web app
 *     - Execute as: Me
 *     - Who has access: Anyone
 *  6. 배포 URL을 복사
 *  7. tb-server.js 시작 시 환경변수 설정:
 *     GOOGLE_MENU_API=https://script.google.com/macros/s/xxxxx/exec
 *
 *  시트 구조 (자동 생성):
 *   - Categories: 카테고리 목록 (id, nameEn, nameKr, icon, color, sortOrder, active, descEn, descKr, extra1-4)
 *   - MenuItems: 메뉴 아이템 (driveId = Google Drive File ID, showOnKiosk, showOnPos, spicyLevel, vatApplicable, mainVat, subVat)
 *   - Sauces: 소스 목록
 *   - BranchPricing: 지점별 가격
 *   - Branches: 지점 목록 (code, name, nameKr, address, phone, active)
 *   - Orders: 주문 기록
 *   - DailySales: 일별 매출 요약
 *  PropertiesService (JSON):
 *   - branchVisibility: 지점별 메뉴 노출 설정
 *   - allergens: 알레르겐 정보
 *   - nutrition: 영양 정보
 *
 *  이미지 업로드:
 *   - Admin에서 이미지 업로드 → base64 → Apps Script → Google Drive 저장
 *   - 원본 이미지 + 썸네일(300x300) 자동 생성
 *   - Drive 폴더: "TheBap_MenuImages" (자동 생성)
 *
 * ════════════════════════════════════════════════════════════
 */

// ─── 시트 이름 ───
const SH_CAT = 'Categories';
const SH_ITEM = 'MenuItems';
const SH_SAUCE = 'Sauces';
const SH_BRANCH = 'BranchPricing';
const SH_ORDER = 'Orders';

// ─── TBMS API (지점 정보 읽기 전용) ───
const TBMS_API = 'https://script.google.com/macros/s/AKfycbwaC6b6WTo4Gw_UpgbpbrVDj52ooG-qqcqPeR4Tgne_bWbzDomXw14SlD0q6QiszZw5/exec';
const TBMS_KEY = 'tBaP2026xKr!mGt9Qz';

// ─── Google Drive 이미지 폴더 ───
const DRIVE_FOLDER_NAME = 'TheBap_MenuImages';
const THUMB_FOLDER_NAME = 'TheBap_Thumbnails';
const THUMB_SIZE = 300; // 썸네일 최대 크기 (px)

// ═══════════════════════════════════════════
//  GET 요청 처리
// ═══════════════════════════════════════════
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'menu';

    switch (action) {
      case 'menu':       return jsonOut(getFullMenu());
      case 'categories': return jsonOut(getCategories());
      case 'items':      return jsonOut(getItems());
      case 'sauces':     return jsonOut(getSauces());
      case 'orders':     return jsonOut(getOrders(e));
      case 'pending':    return jsonOut(getPendingOrders(e));
      case 'branchPricing': return jsonOut(getBranchPricing());
      case 'branches':   return jsonOut({ branches: getBranches() });
      case 'stores':     return jsonOut(getTBMSStores());
      case 'users':      return jsonOut(getTBMSUsers());
      case 'dailySales': return jsonOut(getDailySales(e));
      case 'init':       return jsonOut(initializeSheets());
      default:           return jsonOut(getFullMenu());
    }
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

// ═══════════════════════════════════════════
//  POST 요청 처리
// ═══════════════════════════════════════════
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'newOrder';

    switch (action) {
      // ─── 메뉴 관리 ───
      case 'updateMenu':       updateFullMenu(data); break;
      case 'updateItem':       updateMenuItem(data.item); break;
      case 'addItem':          addMenuItem(data.item); break;
      case 'deleteItem':       deleteMenuItem(data.itemId); break;

      // ─── 카테고리 관리 ───
      case 'updateCategories': updateCategories(data.categories); break;
      case 'addCategory':      return jsonOut(addCategory(data.category));
      case 'updateCategory':   updateCategory(data.category); break;
      case 'deleteCategory':   deleteCategory(data.categoryId); break;

      // ─── 지점별 가격 ───
      case 'updateBranchPricing': updateBranchPricing(data.branchPricing); break;

      // ─── 이미지 업로드 ───
      case 'uploadImage':      return jsonOut(uploadImageToDrive(data));

      // ─── 주문 ───
      case 'newOrder':         return jsonOut(createOrder(data));
      case 'updateOrder':      updateOrderStatus(data.orderNumber, data.status); break;

      // ─── Daily Sales Summary ───
      case 'saveDailySummary': return jsonOut(saveDailySummary(data.data || data));

      default: return jsonOut({ error: 'Unknown action: ' + action });
    }

    return jsonOut({ success: true, timestamp: new Date().toISOString() });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

// ═══════════════════════════════════════════
//  TBMS API에서 Stores 읽기 (읽기 전용)
// ═══════════════════════════════════════════
function getTBMSStores() {
  const url = TBMS_API + '?action=getSheet&sheet=Stores&apikey=' + encodeURIComponent(TBMS_KEY);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const json = JSON.parse(resp.getContentText());
  if (json.error) return { error: json.error };
  return { stores: json.rows || json };
}

// ═══════════════════════════════════════════
//  TBMS API에서 Users 읽기 (읽기 전용)
// ═══════════════════════════════════════════
function getTBMSUsers() {
  const url = TBMS_API + '?action=getSheet&sheet=Users&apikey=' + encodeURIComponent(TBMS_KEY);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const json = JSON.parse(resp.getContentText());
  if (json.error) return { error: json.error };
  return { users: json.rows || json };
}

// ═══════════════════════════════════════════
//  Daily Sales Summary (로컬 → Google Sheets)
// ═══════════════════════════════════════════
const SH_DAILY_SALES = 'DailySales';
const DAILY_SALES_HEADERS = ['date','branchCode','branchName','totalOrders','cashTotal','cardTotal','grandTotal','openingFloat','savedAt'];

function saveDailySummary(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SH_DAILY_SALES);
  if (!sheet) {
    sheet = ss.insertSheet(SH_DAILY_SALES);
    sheet.appendRow(DAILY_SALES_HEADERS);
    sheet.getRange(1, 1, 1, DAILY_SALES_HEADERS.length).setFontWeight('bold');
  }
  // Check for duplicate (same date + branchCode)
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.date && rows[i][1] === data.branchCode) {
      // Update existing row
      sheet.getRange(i + 1, 1, 1, DAILY_SALES_HEADERS.length).setValues([[
        data.date, data.branchCode, data.branchName || '',
        data.totalOrders || 0, data.cashTotal || 0, data.cardTotal || 0,
        data.grandTotal || 0, data.openingFloat || 0, new Date().toISOString()
      ]]);
      return { success: true, updated: true, date: data.date, branchCode: data.branchCode };
    }
  }
  // Append new row
  sheet.appendRow([
    data.date, data.branchCode, data.branchName || '',
    data.totalOrders || 0, data.cashTotal || 0, data.cardTotal || 0,
    data.grandTotal || 0, data.openingFloat || 0, new Date().toISOString()
  ]);
  return { success: true, date: data.date, branchCode: data.branchCode };
}

function getDailySales(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SH_DAILY_SALES);
  if (!sheet) return { sales: [] };
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { sales: [] };
  const headers = rows[0];
  const from = e?.parameter?.from || '';
  const to = e?.parameter?.to || '9999-12-31';
  const branch = e?.parameter?.branch || '';
  const sales = [];
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    headers.forEach((h, j) => obj[h] = rows[i][j]);
    if (obj.date >= from && obj.date <= to && (!branch || obj.branchCode === branch)) {
      sales.push(obj);
    }
  }
  return { sales };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════
//  메뉴 읽기
// ═══════════════════════════════════════════
function getFullMenu() {
  return {
    version: getMenuVersion(),
    lastUpdated: new Date().toISOString(),
    googleSheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
    categories: getCategories(),
    items: getItems(),
    sauces: getSauces(),
    branchPricing: getBranchPricing(),
    branches: getBranches(),
    branchVisibility: loadJsonProperty('branchVisibility'),
    allergens: loadJsonProperty('allergens'),
    nutrition: loadJsonProperty('nutrition'),
  };
}

function getMenuVersion() {
  return parseInt(PropertiesService.getScriptProperties().getProperty('menuVersion') || '1');
}
function incrementMenuVersion() {
  const v = getMenuVersion() + 1;
  PropertiesService.getScriptProperties().setProperty('menuVersion', v.toString());
  return v;
}

function sheetToArray(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).filter(row => row[0]).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function getCategories() {
  return sheetToArray(SH_CAT).map(c => ({
    ...c,
    sortOrder: parseInt(c.sortOrder) || 0,
    active: c.active === true || c.active === 'TRUE' || c.active === 'true',
  }));
}

function getItems() {
  return sheetToArray(SH_ITEM).map(item => ({
    ...item,
    price: parseFloat(item.price) || 0,
    sortOrder: parseInt(item.sortOrder) || 0,
    active: item.active === true || item.active === 'TRUE' || item.active === 'true',
    isCombo: item.isCombo === true || item.isCombo === 'TRUE' || item.isCombo === 'true',
    hasTopping: item.hasTopping === true || item.hasTopping === 'TRUE' || item.hasTopping === 'true',
    comboCount: parseInt(item.comboCount) || 0,
    toppingCount: parseInt(item.toppingCount) || 0,
    dietary: typeof item.dietary === 'string'
      ? item.dietary.split(',').map(s => s.trim()).filter(Boolean) : [],
  }));
}

function getSauces() {
  return sheetToArray(SH_SAUCE).map(s => ({
    ...s,
    price: parseFloat(s.price) || 0,
    spiceLevel: parseInt(s.spiceLevel) || 0,
  }));
}

function getBranchPricing() {
  const rows = sheetToArray(SH_BRANCH);
  const result = {};
  rows.forEach(row => {
    if (!result[row.branchCode]) result[row.branchCode] = {};
    result[row.branchCode][row.itemId] = parseFloat(row.price) || 0;
  });
  return result;
}

// ═══════════════════════════════════════════
//  메뉴 쓰기
// ═══════════════════════════════════════════
function updateFullMenu(data) {
  if (data.categories) updateCategories(data.categories);
  if (data.items) updateAllItems(data.items);
  if (data.sauces) updateAllSauces(data.sauces);
  if (data.branchPricing) updateBranchPricing(data.branchPricing);
  // ─── 새 데이터 타입 (Branches 시트 + JSON PropertiesService) ───
  if (data.branches) updateBranches(data.branches);
  if (data.branchVisibility) saveJsonProperty('branchVisibility', data.branchVisibility);
  if (data.allergens) saveJsonProperty('allergens', data.allergens);
  if (data.nutrition) saveJsonProperty('nutrition', data.nutrition);
  incrementMenuVersion();
}

// ─── Categories CRUD ───
const CAT_HEADERS = ['id','nameEn','nameKr','icon','color','sortOrder','active','descEn','descKr','extra1','extra2','extra3','extra4'];

function updateCategories(categories) {
  writeSheet(SH_CAT, CAT_HEADERS, categories);
}

function addCategory(cat) {
  const sheet = getOrCreateSheet(SH_CAT);
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(CAT_HEADERS);
    formatHeader(sheet, CAT_HEADERS.length);
  }
  // Auto-generate ID if missing
  if (!cat.id) {
    cat.id = 'cat_' + Date.now();
  }
  sheet.appendRow(CAT_HEADERS.map(h => cat[h] !== undefined ? cat[h] : ''));
  incrementMenuVersion();
  return { success: true, category: cat };
}

function updateCategory(cat) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_CAT);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const headers = data[0], idCol = headers.indexOf('id');
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === cat.id) {
      headers.forEach((h, c) => {
        if (cat[h] !== undefined) {
          sheet.getRange(r + 1, c + 1).setValue(cat[h]);
        }
      });
      break;
    }
  }
  incrementMenuVersion();
}

function deleteCategory(catId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_CAT);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('id');
  for (let r = data.length - 1; r >= 1; r--) {
    if (data[r][idCol] === catId) { sheet.deleteRow(r + 1); break; }
  }
  incrementMenuVersion();
}

// ─── MenuItems ───
const ITEM_HEADERS = ['id','catId','nameEn','nameKr','desc','price','driveId','dietary','isCombo','comboCount','hasTopping','toppingCount','btnColor','active','sortOrder','showOnKiosk','showOnPos','spicyLevel','vatApplicable','mainVat','subVat'];

function updateAllItems(items) {
  writeSheet(SH_ITEM, ITEM_HEADERS, items, (item, h) => {
    if (h === 'dietary' && Array.isArray(item[h])) return item[h].join(',');
    return item[h];
  });
}

function addMenuItem(item) {
  const sheet = getOrCreateSheet(SH_ITEM);
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(ITEM_HEADERS);
    formatHeader(sheet, ITEM_HEADERS.length);
  }
  sheet.appendRow(ITEM_HEADERS.map(h => {
    if (h === 'dietary' && Array.isArray(item[h])) return item[h].join(',');
    return item[h] !== undefined ? item[h] : '';
  }));
  incrementMenuVersion();
}

function updateMenuItem(item) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_ITEM);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const headers = data[0], idCol = headers.indexOf('id');
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === item.id) {
      headers.forEach((h, c) => {
        if (item[h] !== undefined) {
          let val = item[h];
          if (h === 'dietary' && Array.isArray(val)) val = val.join(',');
          sheet.getRange(r + 1, c + 1).setValue(val);
        }
      });
      break;
    }
  }
  incrementMenuVersion();
}

function deleteMenuItem(itemId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_ITEM);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('id');
  for (let r = data.length - 1; r >= 1; r--) {
    if (data[r][idCol] === itemId) { sheet.deleteRow(r + 1); break; }
  }
  incrementMenuVersion();
}

// ─── Sauces ───
function updateAllSauces(sauces) {
  writeSheet(SH_SAUCE, ['id','nameEn','nameKr','price','spiceLevel'], sauces);
}

// ─── Branches (지점 목록) ───
const SH_BRANCHES = 'Branches';
const BRANCH_HEADERS = ['code','name','nameKr','address','phone','active'];

function updateBranches(branches) {
  if (!Array.isArray(branches) || branches.length === 0) return;
  writeSheet(SH_BRANCHES, BRANCH_HEADERS, branches);
}

function getBranches() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_BRANCHES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).filter(row => row[0]).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    if (obj.active !== undefined) {
      obj.active = obj.active === true || obj.active === 'TRUE' || obj.active === 'true';
    }
    return obj;
  });
}

// ─── JSON PropertiesService (복잡한 중첩 객체 저장용) ───
// branchVisibility, allergens, nutrition 등 시트에 맞지 않는 데이터
// PropertiesService는 9KB/property 제한 → 큰 데이터는 분할 저장
function saveJsonProperty(key, value) {
  const json = JSON.stringify(value);
  const props = PropertiesService.getScriptProperties();
  // 단일 property에 저장 (9KB 미만이면 OK)
  if (json.length < 8000) {
    props.setProperty('json_' + key, json);
    props.deleteProperty('json_' + key + '_chunks');
  } else {
    // 분할 저장 (8000자씩)
    const chunks = [];
    for (let i = 0; i < json.length; i += 8000) {
      chunks.push(json.substring(i, i + 8000));
    }
    props.setProperty('json_' + key + '_chunks', chunks.length.toString());
    for (let i = 0; i < chunks.length; i++) {
      props.setProperty('json_' + key + '_' + i, chunks[i]);
    }
    props.deleteProperty('json_' + key);
  }
}

function loadJsonProperty(key) {
  const props = PropertiesService.getScriptProperties();
  // 단일 property 시도
  const single = props.getProperty('json_' + key);
  if (single) {
    try { return JSON.parse(single); } catch(e) { return null; }
  }
  // 분할 저장 확인
  const chunkCount = parseInt(props.getProperty('json_' + key + '_chunks') || '0');
  if (chunkCount > 0) {
    let json = '';
    for (let i = 0; i < chunkCount; i++) {
      json += props.getProperty('json_' + key + '_' + i) || '';
    }
    try { return JSON.parse(json); } catch(e) { return null; }
  }
  return null;
}

// ─── Branch Pricing ───
function updateBranchPricing(pricing) {
  // pricing = { "TBS": { "M001": 9.55, ... }, "TBR": { ... } }
  const rows = [];
  Object.keys(pricing).forEach(branch => {
    Object.keys(pricing[branch]).forEach(itemId => {
      rows.push({ branchCode: branch, itemId: itemId, price: pricing[branch][itemId] });
    });
  });
  writeSheet(SH_BRANCH, ['branchCode','itemId','price'], rows);
}

// ═══════════════════════════════════════════
//  🖼️ 이미지 업로드 → Google Drive + 썸네일 생성
// ═══════════════════════════════════════════
/**
 * Admin에서 보내는 데이터:
 * {
 *   action: 'uploadImage',
 *   itemId: 'M001',
 *   fileName: 'combo_bap.jpg',
 *   mimeType: 'image/jpeg',
 *   base64: '...(base64 encoded image data)...'
 * }
 *
 * 반환 (TBMS pattern — File ID only):
 * {
 *   success: true,
 *   driveId: 'xxx'    // Google Drive File ID
 * }
 * Client generates display URLs: lh3.googleusercontent.com/d/{driveId}=w{size}
 */
function uploadImageToDrive(data) {
  const { itemId, fileName, mimeType, base64, thumbBase64 } = data;
  if (!base64 || !fileName) throw new Error('Missing image data or filename');

  // 1) Folder
  const folder = getOrCreateDriveFolder(DRIVE_FOLDER_NAME);

  // 2) Delete existing file (overwrite)
  deleteFileByName(folder, itemId + '_' + fileName);

  // 3) base64 → Blob → Drive (client already resized to 750px)
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, itemId + '_' + fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const fileId = file.getId();

  // 4) Update MenuItems sheet — store File ID only (TBMS pattern)
  if (itemId) {
    updateMenuItem({ id: itemId, driveId: fileId });
  }

  // 5) Return File ID — client generates display URLs as needed
  return {
    success: true,
    driveId: fileId,
  };
}

/**
 * 썸네일 생성 — Google Apps Script에서 이미지 리사이즈
 * 방법: 임시 Google Doc에 이미지 삽입 → 리사이즈 → export
 * 대안: UrlFetchApp으로 external resize API 사용
 *
 * 가장 실용적인 방법: blob을 그대로 저장하되 이름에 "thumb" 표시하고,
 * 클라이언트에서 CSS로 리사이즈. 또는 Google Drive thumbnail API 사용.
 *
 * 여기서는 Google Drive의 내장 썸네일 API를 활용합니다:
 * https://drive.google.com/thumbnail?id=FILE_ID&sz=w300
 */
function createThumbnail(originalBlob, mimeType, thumbName) {
  // Apps Script에서 순수 이미지 리사이즈는 제한적
  // 실용적 방법: 원본을 그대로 저장하고, URL에서 썸네일 크기 지정
  // 클라이언트가 thumbnailUrl 대신 Drive thumbnail API 사용:
  // https://drive.google.com/thumbnail?id=FILE_ID&sz=w300

  // 원본 blob 그대로 반환 (Drive thumbnail API가 자동으로 리사이즈)
  originalBlob.setName(thumbName);
  return originalBlob;
}

/**
 * Google Drive 썸네일 URL 생성 헬퍼
 * 이 URL은 Google Drive가 자동으로 이미지를 리사이즈해서 제공
 */
function getDriveThumbnailUrl(fileId, size) {
  size = size || THUMB_SIZE;
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w' + size;
}

function getOrCreateDriveFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

function deleteFileByName(folder, name) {
  const files = folder.getFilesByName(name);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}

// ═══════════════════════════════════════════
//  주문 관리
// ═══════════════════════════════════════════
function createOrder(data) {
  const sheet = getOrCreateSheet(SH_ORDER);
  const ORDER_HEADERS = ['orderNumber','branchCode','branchName','orderType','items','subtotal','vat','total','status','createdAt','customerName','source','paymentMethod','paymentStatus'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(ORDER_HEADERS);
    formatHeader(sheet, ORDER_HEADERS.length);
  }
  const orderNum = data.orderNumber || ('ORD-' + Date.now());
  sheet.appendRow([
    orderNum, data.branchCode||'', data.branchName||'', data.orderType||'takeaway',
    JSON.stringify(data.items||[]), data.subtotal||0, data.vat||0, data.total||0,
    'pending', new Date().toISOString(), data.customerName||'', data.source||'pos',
    data.paymentMethod||'', data.paymentStatus||'unpaid'
  ]);
  return { success: true, orderNumber: orderNum };
}

function getOrders(e) {
  const rows = sheetToArray(SH_ORDER);
  return { orders: rows.map(r => { try { r.items = JSON.parse(r.items); } catch(x) {} return r; }), count: rows.length };
}

function getPendingOrders(e) {
  const rows = sheetToArray(SH_ORDER).filter(r => r.status === 'pending');
  return { orders: rows.map(r => { try { r.items = JSON.parse(r.items); } catch(x) {} return r; }), count: rows.length };
}

function updateOrderStatus(orderNumber, newStatus) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_ORDER);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('orderNumber'), statusCol = data[0].indexOf('status');
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === orderNumber) {
      sheet.getRange(i + 1, statusCol + 1).setValue(newStatus);
      break;
    }
  }
}

// ═══════════════════════════════════════════
//  유틸리티
// ═══════════════════════════════════════════
function writeSheet(name, headers, rows, transform) {
  const sheet = getOrCreateSheet(name);
  sheet.clear();
  sheet.appendRow(headers);
  rows.forEach(row => {
    sheet.appendRow(headers.map(h => {
      const val = transform ? transform(row, h) : row[h];
      return val !== undefined ? val : '';
    }));
  });
  formatHeader(sheet, headers.length);
}

function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function formatHeader(sheet, colCount) {
  if (sheet.getLastRow() < 1) return;
  const r = sheet.getRange(1, 1, 1, colCount);
  r.setFontWeight('bold').setBackground('#006AFF').setFontColor('#ffffff');
  for (let i = 1; i <= colCount; i++) sheet.autoResizeColumn(i);
  sheet.setFrozenRows(1);
}

// ═══════════════════════════════════════════
//  초기화 (처음 한번만 실행)
// ═══════════════════════════════════════════
/**
 * Google Sheets 메뉴에서 initializeSheets 실행하면
 * 모든 시트가 올바른 헤더와 샘플 데이터로 생성됩니다.
 */
function initializeSheets() {
  // ─── Categories ───
  updateCategories([
    { id: 'kfood', nameEn: 'K-Food', nameKr: 'K-푸드', icon: '🍚', color: '#D97706', sortOrder: 1, active: true },
    { id: 'kchicken', nameEn: 'K-Chicken', nameKr: 'K-치킨', icon: '🍗', color: '#DC2626', sortOrder: 2, active: true },
    { id: 'bbq', nameEn: 'BBQ', nameKr: '불고기', icon: '🔥', color: '#B91C1C', sortOrder: 3, active: true },
    { id: 'bibimbap', nameEn: 'Bibim Bap', nameKr: '비빔밥', icon: '🥗', color: '#059669', sortOrder: 4, active: true },
    { id: 'noodle', nameEn: 'Noodle', nameKr: '국수', icon: '🍜', color: '#7C3AED', sortOrder: 5, active: true },
    { id: 'sides', nameEn: 'Sides', nameKr: '사이드', icon: '🥟', color: '#2563EB', sortOrder: 6, active: true },
    { id: 'drinks', nameEn: 'Drinks', nameKr: '음료', icon: '🥤', color: '#0891B2', sortOrder: 7, active: true },
    { id: 'kids', nameEn: 'Kids / New', nameKr: '키즈/신메뉴', icon: '⭐', color: '#DB2777', sortOrder: 8, active: true },
  ]);

  // ─── MenuItems (with image & thumbnail columns) ───
  const defaultItems = [
    { id:'M001', catId:'kfood', nameEn:'Combo Bap', nameKr:'콤보밥', desc:'Two different choices of topping', price:9.55, driveId:'', dietary:'', isCombo:true, comboCount:2, hasTopping:false, toppingCount:0, btnColor:'#C0392B', active:true, sortOrder:1 },
    { id:'M002', catId:'kfood', nameEn:'Tofu Bap', nameKr:'두부밥', desc:'Fried Tofu on Rice', price:7.45, driveId:'', dietary:'V', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#27AE60', active:true, sortOrder:2 },
    { id:'M003', catId:'kfood', nameEn:'Chicken Teriyaki Bap', nameKr:'치킨데리야끼밥', desc:'Chicken Teriyaki on Rice', price:8.25, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#E67E22', active:true, sortOrder:3 },
    { id:'M004', catId:'kfood', nameEn:'KFC Bap', nameKr:'양념치킨밥', desc:'Korean Fried Chicken', price:8.25, driveId:'', dietary:'spicy', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#E74C3C', active:true, sortOrder:4 },
    { id:'M005', catId:'kfood', nameEn:'Kimchi Fried Rice', nameKr:'김치볶음밥', desc:'Kimchi Fried Rice with egg', price:7.45, driveId:'', dietary:'spicy', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#D35400', active:true, sortOrder:5 },
    { id:'M006', catId:'kchicken', nameEn:'Fried Chicken Bap', nameKr:'후라이드치킨밥', desc:'Korean Fried Chicken', price:8.25, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#F39C12', active:true, sortOrder:1 },
    { id:'M007', catId:'kchicken', nameEn:'Spicy Chicken Bap', nameKr:'매운치킨밥', desc:'Spicy Korean Fried Chicken', price:8.25, driveId:'', dietary:'spicy', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#E74C3C', active:true, sortOrder:2 },
    { id:'M008', catId:'kchicken', nameEn:'Soy Garlic Chicken', nameKr:'간장마늘치킨', desc:'Soy Garlic Glazed Chicken', price:8.25, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#8E44AD', active:true, sortOrder:3 },
    { id:'M009', catId:'bbq', nameEn:'Beef Bulgogi Bap', nameKr:'소불고기밥', desc:'Korean BBQ Beef on Rice', price:8.75, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#C0392B', active:true, sortOrder:1 },
    { id:'M010', catId:'bbq', nameEn:'Pork Bulgogi Bap', nameKr:'돼지불고기밥', desc:'Korean Spicy Pork Bulgogi', price:8.75, driveId:'', dietary:'spicy', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#E74C3C', active:true, sortOrder:2 },
    { id:'M011', catId:'bibimbap', nameEn:'Bibim Bap', nameKr:'비빔밥', desc:'Mixed Rice Bowl', price:7.95, driveId:'', dietary:'V', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#27AE60', active:true, sortOrder:1 },
    { id:'M012', catId:'bibimbap', nameEn:'Bibim Bap + Topping', nameKr:'비빔밥+토핑', desc:'Bibim Bap + Choice of 1 Topping', price:9.95, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:true, toppingCount:1, btnColor:'#16A085', active:true, sortOrder:2 },
    { id:'M013', catId:'noodle', nameEn:'Japchae', nameKr:'잡채', desc:'Korean Glass Noodles', price:7.45, driveId:'', dietary:'V', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#9B59B6', active:true, sortOrder:1 },
    { id:'M014', catId:'noodle', nameEn:'Spicy Ramyeon', nameKr:'매운라면', desc:'Spicy Ramen Noodles', price:6.95, driveId:'', dietary:'spicy', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#E74C3C', active:true, sortOrder:2 },
    { id:'M015', catId:'sides', nameEn:'Chicken Mandu (5)', nameKr:'치킨만두 5개', desc:'Chicken Dumplings', price:4.50, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#F39C12', active:true, sortOrder:1 },
    { id:'M016', catId:'sides', nameEn:'Kim Mari (5)', nameKr:'김말이 5개', desc:'Seaweed Roll Fries', price:3.50, driveId:'', dietary:'V', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#2980B9', active:true, sortOrder:2 },
    { id:'M017', catId:'sides', nameEn:'Tteokbokki', nameKr:'떡볶이', desc:'Spicy Rice Cakes', price:4.50, driveId:'', dietary:'spicy,V', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#E74C3C', active:true, sortOrder:3 },
    { id:'M018', catId:'sides', nameEn:'Korean Pancake', nameKr:'파전', desc:'Vegetable Pancake', price:4.50, driveId:'', dietary:'V', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#1ABC9C', active:true, sortOrder:4 },
    { id:'M019', catId:'sides', nameEn:'Fresh Kimchi', nameKr:'김치', desc:'Homemade Kimchi', price:2.00, driveId:'', dietary:'VG,spicy', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#C0392B', active:true, sortOrder:5 },
    { id:'M020', catId:'drinks', nameEn:'Coca Cola', nameKr:'콜라', desc:'', price:1.50, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#E74C3C', active:true, sortOrder:1 },
    { id:'M021', catId:'drinks', nameEn:'Sprite', nameKr:'스프라이트', desc:'', price:1.50, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#2ECC71', active:true, sortOrder:2 },
    { id:'M022', catId:'drinks', nameEn:'Water', nameKr:'물', desc:'', price:1.00, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#3498DB', active:true, sortOrder:3 },
    { id:'M023', catId:'drinks', nameEn:'Korean Banana Milk', nameKr:'바나나우유', desc:'', price:2.00, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#F1C40F', active:true, sortOrder:4 },
    { id:'M024', catId:'drinks', nameEn:'Iced Tea', nameKr:'아이스티', desc:'', price:2.00, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#E67E22', active:true, sortOrder:5 },
    { id:'M025', catId:'kids', nameEn:"Kid's Bap", nameKr:'키즈밥', desc:'Small portion for kids', price:5.45, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#DB2777', active:true, sortOrder:1 },
    { id:'M026', catId:'kids', nameEn:"Kid's Combo", nameKr:'키즈콤보', desc:"Kid's Bap + Drink + Side", price:6.45, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#7C3AED', active:true, sortOrder:2 },
    { id:'M027', catId:'kids', nameEn:'Corn Dog (2)', nameKr:'핫도그 2개', desc:'Korean Corn Dogs', price:4.50, driveId:'', dietary:'', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#F39C12', active:true, sortOrder:3 },
    { id:'M028', catId:'kids', nameEn:'Honey Hotteok', nameKr:'꿀호떡', desc:'Sweet Pancake with honey', price:3.00, driveId:'', dietary:'V', isCombo:false, comboCount:0, hasTopping:false, toppingCount:0, btnColor:'#D97706', active:true, sortOrder:4 },
  ];
  updateAllItems(defaultItems);

  // ─── Sauces ───
  updateAllSauces([
    { id:'S001', nameEn:'No Sauce', nameKr:'소스 없음', price:0, spiceLevel:0 },
    { id:'S002', nameEn:'Soy Sauce', nameKr:'간장소스', price:0, spiceLevel:0 },
    { id:'S003', nameEn:'Spicy Sauce', nameKr:'매운소스', price:0, spiceLevel:3 },
    { id:'S004', nameEn:'Sweet Chili', nameKr:'스위트칠리', price:0, spiceLevel:1 },
    { id:'S005', nameEn:'Garlic Mayo', nameKr:'갈릭마요', price:0, spiceLevel:0 },
    { id:'S006', nameEn:'Extra Sauce', nameKr:'소스 추가', price:0.30, spiceLevel:0 },
  ]);

  // ─── Branches 시트 ───
  const brSheet = getOrCreateSheet(SH_BRANCHES);
  brSheet.clear();
  brSheet.appendRow(BRANCH_HEADERS);
  formatHeader(brSheet, BRANCH_HEADERS.length);

  // ─── BranchPricing 시트 헤더 ───
  const bpSheet = getOrCreateSheet(SH_BRANCH);
  bpSheet.clear();
  bpSheet.appendRow(['branchCode','itemId','price']);
  formatHeader(bpSheet, 3);

  // ─── Orders 시트 ───
  const orderSheet = getOrCreateSheet(SH_ORDER);
  if (orderSheet.getLastRow() === 0) {
    orderSheet.appendRow(['orderNumber','branchCode','branchName','orderType','items','subtotal','vat','total','status','createdAt','customerName','source','paymentMethod','paymentStatus']);
    formatHeader(orderSheet, 14);
  }

  // ─── Google Drive 이미지 폴더 생성 ───
  getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
  getOrCreateDriveFolder(THUMB_FOLDER_NAME);

  PropertiesService.getScriptProperties().setProperty('menuVersion', '1');

  // 웹앱에서 호출 시 JSON 결과 반환, 에디터에서 실행 시 alert
  try {
    SpreadsheetApp.getUi().alert('✅ 초기화 완료!\n\nSheets: Categories, MenuItems, Sauces, Branches, BranchPricing, Orders, DailySales\nDrive Folders: TheBap_MenuImages, TheBap_Thumbnails\n\n이제 Deploy > New deployment 으로 웹앱을 배포하세요.');
  } catch (e) {
    // 웹앱 모드 — getUi() 불가, 무시
  }
  return { success: true, message: 'Initialized: Categories, MenuItems, Sauces, Branches, BranchPricing, Orders, DailySales + Drive folders' };
}

/**
 * Drive 폴더만 생성 (initializeSheets 타임아웃 시 별도 실행)
 */
function createDriveFolders() {
  getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
  getOrCreateDriveFolder(THUMB_FOLDER_NAME);
  try {
    SpreadsheetApp.getUi().alert('✅ Drive 폴더 생성 완료!\n- ' + DRIVE_FOLDER_NAME + '\n- ' + THUMB_FOLDER_NAME);
  } catch (e) {}
  return { success: true, folders: [DRIVE_FOLDER_NAME, THUMB_FOLDER_NAME] };
}
