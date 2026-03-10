// ═══════════════════════════════════════════════════════════
//  The Bap — ESC/POS Thermal Printer Module
//  Supports: Epson, Star, and generic 80mm ESC/POS printers
//  Connection: Network (TCP port 9100) or USB device path
//  No npm dependencies — pure Node.js
// ═══════════════════════════════════════════════════════════
const net = require('net');
const fs = require('fs');

// ─── ESC/POS Command Constants ───
const ESC = '\x1B';
const GS = '\x1D';
const CMD = {
    INIT:           ESC + '\x40',           // Initialize printer
    BOLD_ON:        ESC + '\x45\x01',
    BOLD_OFF:       ESC + '\x45\x00',
    ALIGN_LEFT:     ESC + '\x61\x00',
    ALIGN_CENTER:   ESC + '\x61\x01',
    ALIGN_RIGHT:    ESC + '\x61\x02',
    SIZE_NORMAL:    GS + '\x21\x00',        // Normal text
    SIZE_DOUBLE_H:  GS + '\x21\x10',        // Double height
    SIZE_DOUBLE_W:  GS + '\x21\x20',        // Double width
    SIZE_DOUBLE:    GS + '\x21\x11',        // Double width + height
    SIZE_LARGE:     GS + '\x21\x22',        // Triple width + height (3x)
    UNDERLINE_ON:   ESC + '\x2D\x01',
    UNDERLINE_OFF:  ESC + '\x2D\x00',
    FEED:           '\x0A',
    CUT:            GS + '\x56\x41\x00',    // Partial cut
    FULL_CUT:       GS + '\x56\x00',        // Full cut
    OPEN_DRAWER:    ESC + '\x70\x00\x19\xFA', // Open cash drawer (pin 2)
    DASHES:         '------------------------------------------------',
    EQUALS:         '================================================',
};

// ─── Helper: pad/align text within fixed width ───
function padLine(left, right, width = 48) {
    const l = String(left || '');
    const r = String(right || '');
    const space = Math.max(1, width - l.length - r.length);
    return l + ' '.repeat(space) + r;
}

function centerText(text, width = 48) {
    const t = String(text);
    const pad = Math.max(0, Math.floor((width - t.length) / 2));
    return ' '.repeat(pad) + t;
}

// ─── Build receipt ESC/POS data ───
function buildOrderReceipt(order, branchName) {
    let d = '';
    d += CMD.INIT;

    // Header — shop name (large, bold, centered)
    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE + CMD.BOLD_ON;
    d += 'The Bap' + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_ON;
    d += (branchName || order.branchCode || '') + CMD.FEED;
    d += CMD.BOLD_OFF;
    d += 'K-Food on the Bap' + CMD.FEED;
    d += CMD.ALIGN_LEFT;
    d += CMD.DASHES + CMD.FEED;

    // Order info
    const dt = new Date(order.timestamp);
    const dateStr = dt.toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    d += CMD.BOLD_ON;
    d += padLine('Date:', dateStr) + CMD.FEED;
    d += padLine('Order:', order.orderNumber) + CMD.FEED;
    d += padLine('Type:', order.orderType === 'eat_in' ? 'Eat In' : 'Take Away') + CMD.FEED;
    if (order.staff) d += padLine('Staff:', order.staff) + CMD.FEED;
    if (order.customerName) d += padLine('Customer:', order.customerName) + CMD.FEED;
    d += CMD.BOLD_OFF;
    d += CMD.DASHES + CMD.FEED;

    // Items
    d += CMD.BOLD_ON;
    (order.items || []).forEach(item => {
        const name = (item.quantity > 1 ? item.quantity + 'x ' : '') + item.nameEn;
        const price = item.free ? 'FREE' : formatPrice(item.totalPrice);
        d += padLine(name, price) + CMD.FEED;
        if (item.note) d += `   (${item.note})` + CMD.FEED;
    });
    d += CMD.BOLD_OFF;
    d += CMD.DASHES + CMD.FEED;

    // Totals
    d += padLine('Subtotal:', formatPrice(order.subtotal)) + CMD.FEED;
    const discAmt = (order.subtotal || 0) - (order.total || 0);
    if (discAmt > 0.005) {
        d += padLine('Discount:', '-' + formatPrice(discAmt)) + CMD.FEED;
    }
    // VAT
    const vatAmt = calcReceiptVat(order);
    d += padLine('VAT (incl):', formatPrice(vatAmt)) + CMD.FEED;
    d += CMD.DASHES + CMD.FEED;

    // Grand Total (big)
    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE + CMD.BOLD_ON;
    d += 'TOTAL: ' + formatPrice(order.total) + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_OFF + CMD.ALIGN_LEFT;
    d += CMD.DASHES + CMD.FEED;

    // Payment info
    if (order.paymentMethod && order.paymentMethod !== 'not_paid') {
        d += CMD.BOLD_ON;
        d += padLine('Payment:', (order.paymentMethod || '').toUpperCase()) + CMD.FEED;
        if (order.amountPaid) d += padLine('Paid:', formatPrice(order.amountPaid)) + CMD.FEED;
        if (order.change > 0) d += padLine('Change:', formatPrice(order.change)) + CMD.FEED;
        d += CMD.BOLD_OFF;
        d += CMD.DASHES + CMD.FEED;
    }

    // Footer
    d += CMD.ALIGN_CENTER;
    d += CMD.FEED;
    d += 'Thank you for visiting The Bap!' + CMD.FEED;
    d += 'K-Food on the Bap' + CMD.FEED;
    d += CMD.FEED + CMD.FEED + CMD.FEED;
    d += CMD.CUT;

    return d;
}

// ─── Build daily report / end sales receipt ───
function buildReportReceipt(data) {
    let d = '';
    d += CMD.INIT;

    // Header
    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE + CMD.BOLD_ON;
    d += 'The Bap' + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_ON;
    d += (data.branchName || '') + CMD.FEED;
    d += CMD.BOLD_OFF;
    d += CMD.ALIGN_LEFT;
    d += CMD.EQUALS + CMD.FEED;

    // Title
    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE_H + CMD.BOLD_ON;
    d += (data.title || 'DAILY REPORT') + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_OFF + CMD.ALIGN_LEFT;
    d += CMD.EQUALS + CMD.FEED;

    // Period
    if (data.from) d += padLine('From:', data.from) + CMD.FEED;
    if (data.to) d += padLine('To:', data.to) + CMD.FEED;
    d += CMD.DASHES + CMD.FEED;

    // Summary
    d += CMD.BOLD_ON;
    d += padLine('Total Orders:', String(data.totalOrders || 0)) + CMD.FEED;
    d += padLine('Cash Customers:', String(data.cashCount || 0)) + CMD.FEED;
    d += padLine('Card Customers:', String(data.cardCount || 0)) + CMD.FEED;
    d += CMD.BOLD_OFF;
    d += CMD.DASHES + CMD.FEED;

    // Payment breakdown
    d += CMD.BOLD_ON;
    d += padLine('Cash Total:', formatPrice(data.cashTotal || 0)) + CMD.FEED;
    d += padLine('Card Total:', formatPrice(data.cardTotal || 0)) + CMD.FEED;
    d += CMD.BOLD_OFF;
    d += CMD.DASHES + CMD.FEED;

    // Grand Total (big)
    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE + CMD.BOLD_ON;
    d += 'TOTAL: ' + formatPrice(data.grandTotal || 0) + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_OFF + CMD.ALIGN_LEFT;
    d += CMD.DASHES + CMD.FEED;

    // Cash in drawer
    if (data.cashInDrawer !== undefined) {
        d += CMD.BOLD_ON;
        d += padLine('Cash in Drawer:', formatPrice(data.cashInDrawer)) + CMD.FEED;
        d += CMD.BOLD_OFF;
        d += CMD.DASHES + CMD.FEED;
    }

    // VAT breakdown
    if (data.vatBreakdown && data.vatBreakdown.length > 0) {
        d += CMD.BOLD_ON + 'VAT Breakdown:' + CMD.FEED + CMD.BOLD_OFF;
        data.vatBreakdown.forEach(v => {
            d += padLine(`  ${v.rate}%  Net:${formatPrice(v.net)}`, `VAT:${formatPrice(v.vat)}`) + CMD.FEED;
        });
        d += padLine('Total VAT:', formatPrice(data.totalVat || 0)) + CMD.FEED;
        d += CMD.DASHES + CMD.FEED;
    }

    // Footer
    d += CMD.ALIGN_CENTER;
    d += 'Printed: ' + new Date().toLocaleString('en-GB') + CMD.FEED;
    d += CMD.FEED + CMD.FEED + CMD.FEED;
    d += CMD.CUT;

    return d;
}

// ─── Open cash drawer command ───
function buildOpenDrawer() {
    return CMD.INIT + CMD.OPEN_DRAWER;
}

// ─── Send to printer ───
function sendToPrinter(printerConfig, data) {
    return new Promise((resolve, reject) => {
        if (!printerConfig || (!printerConfig.ip && !printerConfig.device)) {
            return reject(new Error('No printer configured'));
        }

        const buffer = Buffer.from(data, 'binary');

        // Network printer (TCP)
        if (printerConfig.ip) {
            const port = printerConfig.port || 9100;
            const timeout = printerConfig.timeout || 5000;
            const sock = new net.Socket();
            let done = false;

            sock.setTimeout(timeout);
            sock.on('timeout', () => { if (!done) { done = true; sock.destroy(); reject(new Error(`Printer timeout (${printerConfig.ip}:${port})`)); }});
            sock.on('error', (err) => { if (!done) { done = true; reject(new Error(`Printer error: ${err.message}`)); }});

            sock.connect(port, printerConfig.ip, () => {
                sock.write(buffer, () => {
                    // Small delay to ensure data is flushed
                    setTimeout(() => {
                        if (!done) { done = true; sock.end(); resolve({ success: true, method: 'network', target: `${printerConfig.ip}:${port}` }); }
                    }, 200);
                });
            });

        // USB / device path (e.g., /dev/usb/lp0 or \\.\USB001)
        } else if (printerConfig.device) {
            try {
                fs.writeFileSync(printerConfig.device, buffer);
                resolve({ success: true, method: 'usb', target: printerConfig.device });
            } catch (err) {
                reject(new Error(`USB print error: ${err.message}`));
            }
        }
    });
}

// ─── Helpers ───
function formatPrice(n) {
    return '£' + (Number(n) || 0).toFixed(2);
}

function calcReceiptVat(order) {
    let totalVat = 0;
    (order.items || []).forEach(item => {
        if (item.free) return;
        const rate = (item.vatRate || 20) / 100;
        totalVat += (item.totalPrice || 0) * rate / (1 + rate);
    });
    return totalVat;
}

module.exports = {
    buildOrderReceipt,
    buildReportReceipt,
    buildOpenDrawer,
    sendToPrinter,
    CMD,
};
