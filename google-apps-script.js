/**
 * ════════════════════════════════════════════════════════════
 *  🍚 The Bap (더밥) — Google Apps Script (주문 API)
 * ════════════════════════════════════════════════════════════
 *
 *  설치 방법:
 *  1. Google Sheets에서 새 스프레드시트 생성
 *  2. 시트 이름을 "Orders"로 변경
 *  3. 확장프로그램 → Apps Script 클릭
 *  4. 이 코드를 전부 붙여넣기
 *  5. 배포 → 새 배포 → 웹 앱 선택
 *     - "다음 계정으로 실행" → 나
 *     - "액세스 권한" → 모든 사용자
 *  6. 배포 후 나오는 URL을 복사
 *  7. mobile.html의 APPS_SCRIPT_URL에 붙여넣기
 *
 * ════════════════════════════════════════════════════════════
 */

// ─── 설정 ───
const SHEET_NAME = 'Orders';

// ─── 헤더 자동 생성 ───
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // 헤더가 없으면 추가
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'orderNumber',    // A
      'branchCode',     // B
      'branchName',     // C
      'orderType',      // D
      'items',          // E (JSON)
      'subtotal',       // F
      'vat',            // G
      'total',          // H
      'status',         // I
      'createdAt',      // J
      'customerName',   // K
      'customerPhone',  // L
      'pickupTime',     // M
      'source',         // N (mobile/kiosk)
      'fetchedByKitchen' // O (yes/no)
    ]);

    // 헤더 스타일
    const headerRange = sheet.getRange(1, 1, 1, 15);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#E85D75');
    headerRange.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
}

// ─── POST: 새 주문 접수 ───
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      setupSheet();
      sheet = ss.getSheetByName(SHEET_NAME);
    }

    // 주문 번호 생성 (MOB-001, MOB-002...)
    const lastRow = sheet.getLastRow();
    let orderNum = data.orderNumber;
    if (!orderNum) {
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const count = lastRow; // 헤더 포함
      orderNum = `MOB-${today}-${String(count).padStart(3, '0')}`;
    }

    // 시트에 주문 추가
    sheet.appendRow([
      orderNum,
      data.branchCode || '',
      data.branchName || '',
      data.orderType || 'take_away',
      JSON.stringify(data.items || []),
      data.subtotal || 0,
      data.vat || 0,
      data.total || 0,
      'pending',
      new Date().toISOString(),
      data.customerName || '',
      data.customerPhone || '',
      data.pickupTime || '',
      'mobile',
      'no'
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        orderNumber: orderNum,
        message: 'Order received!'
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── GET: 새 주문 가져오기 (주방용) ───
function doGet(e) {
  try {
    const action = e.parameter.action || 'pending';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet || sheet.getLastRow() <= 1) {
      return ContentService
        .createTextOutput(JSON.stringify({ orders: [], count: 0 }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const orders = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const order = {};
      headers.forEach((h, j) => { order[h] = row[j]; });

      if (action === 'pending') {
        // 주방이 아직 안 가져간 주문만
        if (order.fetchedByKitchen !== 'yes' && order.status === 'pending') {
          // items를 JSON 파싱
          try { order.items = JSON.parse(order.items); } catch(e) { order.items = []; }
          order._row = i + 1; // 시트 행 번호 (업데이트용)
          orders.push(order);
        }
      } else if (action === 'all') {
        try { order.items = JSON.parse(order.items); } catch(e) { order.items = []; }
        orders.push(order);
      }
    }

    // pending 주문을 가져갔으면 fetchedByKitchen = 'yes'로 표시
    if (action === 'pending' && e.parameter.markFetched === 'true') {
      orders.forEach(order => {
        if (order._row) {
          sheet.getRange(order._row, 15).setValue('yes'); // O열 = fetchedByKitchen
        }
      });
      // _row 제거
      orders.forEach(order => delete order._row);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        orders: orders,
        count: orders.length,
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        orders: [],
        count: 0,
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── 주문 상태 업데이트 (주방에서 호출) ───
function updateOrderStatus(orderNumber, newStatus) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderNumber) {
      sheet.getRange(i + 1, 9).setValue(newStatus); // I열 = status
      return true;
    }
  }
  return false;
}
