// ═══════════════════════════════════════════════════════════
//  The Bap — ESC/POS Thermal Printer Module  v3.1
//
//  Windows USB 프린터: winspool.Drv API 경유 (유일한 방법)
//    → C# helper .exe를 1회 컴파일 후 재사용 (PowerShell보다 10배 빠름)
//  Network 프린터: TCP 소켓 (port 9100)
//  Linux/Mac USB: fs.writeFileSync (device path)
//
//  v3.1 — codepage 자동 감지: WPC1252(£=0xA3) / CP437(£=0x9C)
//         printer-config.json의 codepage 필드로 지점별 설정 가능
//
//  No npm dependencies — pure Node.js
// ═══════════════════════════════════════════════════════════
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Codepage Configuration ───
// 프린터 모델에 따라 지원하는 codepage가 다름
// WPC1252 (Code Page 16): £ = 0xA3 — 대부분의 최신 프린터
// CP437   (Code Page 0):  £ = 0x9C — 구형/일부 프린터 (Bristol TBB 등)
let _currentCodepage = 'WPC1252';  // default

const CODEPAGE_MAP = {
    'WPC1252': { cmd: '\x10', pound: '\xA3' },  // Code Page 16
    'CP437':   { cmd: '\x00', pound: '\x9C' },  // Code Page 0
    'CP858':   { cmd: '\x13', pound: '\x9C' },  // Code Page 19 (CP437 + €)
};

function setCodepage(cp) {
    if (CODEPAGE_MAP[cp]) {
        _currentCodepage = cp;
        console.log(`[Printer] Codepage set to ${cp} (£ = 0x${CODEPAGE_MAP[cp].pound.charCodeAt(0).toString(16).toUpperCase()})`);
    } else {
        console.warn(`[Printer] Unknown codepage "${cp}", keeping ${_currentCodepage}`);
    }
}

function getCodepageCmd() {
    return ESC + '\x74' + (CODEPAGE_MAP[_currentCodepage] || CODEPAGE_MAP['WPC1252']).cmd;
}

function getPoundChar() {
    return (CODEPAGE_MAP[_currentCodepage] || CODEPAGE_MAP['WPC1252']).pound;
}

// ─── ESC/POS Command Constants ───
const ESC = '\x1B';
const GS = '\x1D';
const CMD = {
    INIT:           ESC + '\x40',
    // Codepage은 동적으로 설정됨 — getCodepageCmd() 사용
    CODEPAGE:       null,  // 아래 buildOrderReceipt 등에서 getCodepageCmd() 호출
    BOLD_ON:        ESC + '\x45\x01',
    BOLD_OFF:       ESC + '\x45\x00',
    ALIGN_LEFT:     ESC + '\x61\x00',
    ALIGN_CENTER:   ESC + '\x61\x01',
    ALIGN_RIGHT:    ESC + '\x61\x02',
    SIZE_NORMAL:    GS + '\x21\x00',
    SIZE_DOUBLE_H:  GS + '\x21\x10',
    SIZE_DOUBLE_W:  GS + '\x21\x20',
    SIZE_DOUBLE:    GS + '\x21\x11',
    SIZE_LARGE:     GS + '\x21\x22',
    UNDERLINE_ON:   ESC + '\x2D\x01',
    UNDERLINE_OFF:  ESC + '\x2D\x00',
    FEED:           '\x0A',
    CUT:            GS + '\x56\x41\x00',
    FULL_CUT:       GS + '\x56\x00',
    OPEN_DRAWER:    ESC + '\x70\x00\x19\xFA',
    DASHES:         '------------------------------------------------',
    EQUALS:         '================================================',
};

// ─── Helpers ───
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

function formatPrice(n) {
    return getPoundChar() + (Number(n) || 0).toFixed(2);
}

// ─── Convert ESC/POS string to Buffer ───
// ESC/POS commands use raw bytes 0x00-0xFF.
// JS string with \xNN chars → Buffer byte-by-byte.
// £ 기호는 codepage에 따라 동적으로 결정됨 (getPoundChar())
function toEscPosBuffer(str) {
    const len = str.length;
    const buf = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
        buf[i] = str.charCodeAt(i) & 0xFF;
    }
    return buf;
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

// ─── Build receipt ESC/POS data ───
function buildOrderReceipt(order, branchName, vatNo) {
    let d = '';
    d += CMD.INIT + getCodepageCmd();
    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE + CMD.BOLD_ON;
    d += 'The Bap' + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_ON;
    d += (branchName || order.branchCode || '') + CMD.FEED;
    d += CMD.BOLD_OFF;
    d += 'K-Food on the Bap' + CMD.FEED;
    d += CMD.ALIGN_LEFT;
    d += CMD.DASHES + CMD.FEED;

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

    d += CMD.BOLD_ON;
    (order.items || []).forEach(item => {
        const name = (item.quantity > 1 ? item.quantity + 'x ' : '') + item.nameEn;
        const price = item.free ? 'FREE' : formatPrice(item.totalPrice);
        d += padLine(name, price) + CMD.FEED;
        if (item.note) d += `   (${item.note})` + CMD.FEED;
    });
    d += CMD.BOLD_OFF;
    d += CMD.DASHES + CMD.FEED;

    d += padLine('Subtotal:', formatPrice(order.subtotal)) + CMD.FEED;
    const discAmt = (order.subtotal || 0) - (order.total || 0);
    if (discAmt > 0.005) {
        d += padLine('Discount:', '-' + formatPrice(discAmt)) + CMD.FEED;
    }
    const vatAmt = calcReceiptVat(order);
    d += padLine('VAT (incl):', formatPrice(vatAmt)) + CMD.FEED;
    d += CMD.DASHES + CMD.FEED;

    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE + CMD.BOLD_ON;
    d += 'TOTAL: ' + formatPrice(order.total) + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_OFF + CMD.ALIGN_LEFT;
    d += CMD.DASHES + CMD.FEED;

    if (order.paymentMethod && order.paymentMethod !== 'not_paid') {
        d += CMD.BOLD_ON;
        d += padLine('Payment:', (order.paymentMethod || '').toUpperCase()) + CMD.FEED;
        if (order.amountPaid) d += padLine('Paid:', formatPrice(order.amountPaid)) + CMD.FEED;
        if (order.change > 0) d += padLine('Change:', formatPrice(order.change)) + CMD.FEED;
        d += CMD.BOLD_OFF;
        d += CMD.DASHES + CMD.FEED;
    }

    d += CMD.ALIGN_CENTER;
    d += CMD.FEED;
    d += 'Thank you for visiting The Bap!' + CMD.FEED;
    if (vatNo) d += 'VAT No: ' + vatNo + CMD.FEED;
    d += CMD.FEED + CMD.FEED + CMD.FEED;
    d += CMD.CUT;

    return d;
}

// ─── Build report receipt ───
function buildReportReceipt(data) {
    let d = '';
    d += CMD.INIT + getCodepageCmd();
    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE + CMD.BOLD_ON;
    d += 'The Bap' + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_ON;
    d += (data.branchName || '') + CMD.FEED;
    d += CMD.BOLD_OFF + CMD.ALIGN_LEFT;
    d += CMD.EQUALS + CMD.FEED;

    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE_H + CMD.BOLD_ON;
    d += (data.title || 'DAILY REPORT') + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_OFF + CMD.ALIGN_LEFT;
    d += CMD.EQUALS + CMD.FEED;

    if (data.from) d += padLine('From:', data.from) + CMD.FEED;
    if (data.to) d += padLine('To:', data.to) + CMD.FEED;
    d += CMD.DASHES + CMD.FEED;

    d += CMD.BOLD_ON;
    d += padLine('Total Orders:', String(data.totalOrders || 0)) + CMD.FEED;
    d += padLine('Cash Customers:', String(data.cashCount || 0)) + CMD.FEED;
    d += padLine('Card Customers:', String(data.cardCount || 0)) + CMD.FEED;
    d += CMD.BOLD_OFF + CMD.DASHES + CMD.FEED;

    d += CMD.BOLD_ON;
    d += padLine('Cash Total:', formatPrice(data.cashTotal || 0)) + CMD.FEED;
    d += padLine('Card Total:', formatPrice(data.cardTotal || 0)) + CMD.FEED;
    d += CMD.BOLD_OFF + CMD.DASHES + CMD.FEED;

    d += CMD.ALIGN_CENTER + CMD.SIZE_DOUBLE + CMD.BOLD_ON;
    d += 'TOTAL: ' + formatPrice(data.grandTotal || 0) + CMD.FEED;
    d += CMD.SIZE_NORMAL + CMD.BOLD_OFF + CMD.ALIGN_LEFT;
    d += CMD.DASHES + CMD.FEED;

    if (data.cashInDrawer !== undefined) {
        d += CMD.BOLD_ON;
        d += padLine('Cash in Drawer:', formatPrice(data.cashInDrawer)) + CMD.FEED;
        d += CMD.BOLD_OFF + CMD.DASHES + CMD.FEED;
    }

    if (data.vatBreakdown && data.vatBreakdown.length > 0) {
        d += CMD.BOLD_ON + 'VAT Breakdown:' + CMD.FEED + CMD.BOLD_OFF;
        data.vatBreakdown.forEach(v => {
            d += padLine(`  ${v.rate}%  Net:${formatPrice(v.net)}`, `VAT:${formatPrice(v.vat)}`) + CMD.FEED;
        });
        d += padLine('Total VAT:', formatPrice(data.totalVat || 0)) + CMD.FEED;
        d += CMD.DASHES + CMD.FEED;
    }

    d += CMD.ALIGN_CENTER;
    if (data.vatNo) d += 'VAT No: ' + data.vatNo + CMD.FEED;
    d += 'Printed: ' + new Date().toLocaleString('en-GB') + CMD.FEED;
    d += CMD.FEED + CMD.FEED + CMD.FEED;
    d += CMD.CUT;

    return d;
}

// ─── Open cash drawer ESC/POS command ───
function buildOpenDrawer() {
    return CMD.INIT
        + ESC + '\x70\x00\x19\xFA'   // Pin 2 kick
        + ESC + '\x70\x01\x19\xFA';  // Pin 5 kick
}


// ═══════════════════════════════════════════════════════════
//  Windows Print Helper (.exe) — 1회 컴파일, 이후 재사용
//  PowerShell보다 10배 빠름 (PS: ~2초, .exe: ~0.1초)
// ═══════════════════════════════════════════════════════════

const HELPER_CS = `
using System;
using System.IO;
using System.Runtime.InteropServices;

class TheBapPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    struct DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDatatype;
    }
    [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool StartDocPrinter(IntPtr h, int l, ref DOCINFOA d);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool ClosePrinter(IntPtr h);

    static int Main(string[] args) {
        if (args.Length < 2) {
            Console.Error.WriteLine("Usage: thebap_print.exe <PrinterName> <DataFile>");
            return 1;
        }
        string printerName = args[0];
        string dataFile = args[1];

        if (!File.Exists(dataFile)) {
            Console.Error.WriteLine("ERR:File not found:" + dataFile);
            return 2;
        }

        byte[] bytes = File.ReadAllBytes(dataFile);
        IntPtr hPrinter = IntPtr.Zero;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
            int err = Marshal.GetLastWin32Error();
            Console.Error.WriteLine("ERR:OpenPrinter failed:" + printerName + " code:" + err);
            return 3;
        }
        try {
            DOCINFOA di = new DOCINFOA();
            di.pDocName = "TheBap";
            di.pDatatype = "RAW";
            if (!StartDocPrinter(hPrinter, 1, ref di)) {
                Console.Error.WriteLine("ERR:StartDocPrinter failed");
                return 4;
            }
            StartPagePrinter(hPrinter);
            IntPtr ptr = Marshal.AllocCoTaskMem(bytes.Length);
            Marshal.Copy(bytes, 0, ptr, bytes.Length);
            int written = 0;
            WritePrinter(hPrinter, ptr, bytes.Length, out written);
            Marshal.FreeCoTaskMem(ptr);
            EndPagePrinter(hPrinter);
            EndDocPrinter(hPrinter);
            Console.WriteLine("OK:" + written);
            return 0;
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
`;

// ─── Compile helper .exe (once) ───
let _helperExe = null;

function getHelperPath() {
    return path.join(__dirname, 'data', 'thebap_print.exe');
}

function ensureHelper() {
    if (_helperExe && fs.existsSync(_helperExe)) return _helperExe;

    const exePath = getHelperPath();
    if (fs.existsSync(exePath)) {
        _helperExe = exePath;
        console.log('[Printer] Helper .exe found:', exePath);
        return exePath;
    }

    // Need to compile
    console.log('[Printer] Compiling print helper...');
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const csPath = path.join(dataDir, 'thebap_print.cs');
    fs.writeFileSync(csPath, HELPER_CS, 'utf8');

    // Find csc.exe (.NET Framework — available on ALL Windows 7/8/10/11)
    const { execSync } = require('child_process');
    const cscPaths = [
        path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
        path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
    ];
    const csc = cscPaths.find(p => fs.existsSync(p));
    if (!csc) {
        console.error('[Printer] csc.exe not found! Paths tried:', cscPaths);
        throw new Error('C# compiler (csc.exe) not found. .NET Framework 4.x required.');
    }

    try {
        execSync(`"${csc}" /nologo /optimize /out:"${exePath}" "${csPath}"`, {
            windowsHide: true,
            timeout: 30000
        });
        console.log('[Printer] Helper compiled OK:', exePath);
        _helperExe = exePath;
        return exePath;
    } catch (e) {
        console.error('[Printer] Helper compile failed:', e.message);
        throw new Error('Failed to compile print helper: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════
//  sendToPrinter — 통합 전송 함수
//  우선순위: ip(TCP) → printerName(Windows .exe helper) → device(Linux/Mac USB)
// ═══════════════════════════════════════════════════════════
function sendToPrinter(printerConfig, data) {
    return new Promise(async (resolve, reject) => {
        if (!printerConfig) return reject(new Error('No printer config'));

        const buffer = toEscPosBuffer(data);
        const hasIP = !!printerConfig.ip;
        const hasName = !!printerConfig.printerName;
        const hasDevice = !!printerConfig.device;
        const isWin = process.platform === 'win32';

        if (!hasIP && !hasName && !hasDevice) {
            return reject(new Error('Printer not configured'));
        }

        // ── Method 1: Network TCP ──
        if (hasIP) {
            const port = printerConfig.port || 9100;
            const timeout = printerConfig.timeout || 5000;
            const sock = new net.Socket();
            let done = false;
            sock.setTimeout(timeout);
            sock.on('timeout', () => { if (!done) { done = true; sock.destroy(); reject(new Error(`Timeout ${printerConfig.ip}:${port}`)); }});
            sock.on('error', (err) => { if (!done) { done = true; reject(new Error(`Network: ${err.message}`)); }});
            sock.connect(port, printerConfig.ip, () => {
                sock.write(buffer, () => {
                    setTimeout(() => {
                        if (!done) { done = true; sock.end(); resolve({ success: true, method: 'network', target: `${printerConfig.ip}:${port}` }); }
                    }, 200);
                });
            });
            return;
        }

        // ── Method 2: Windows — compiled .exe helper (winspool.Drv RAW) ──
        if (isWin && hasName) {
            try {
                const result = await sendViaHelper(printerConfig.printerName, buffer);
                resolve(result);
            } catch (e1) {
                console.warn('[Printer] Helper failed:', e1.message, '→ trying PowerShell...');
                // Fallback to PowerShell
                try {
                    const result = await sendViaPowerShell(printerConfig.printerName, buffer);
                    resolve(result);
                } catch (e2) {
                    reject(new Error(`All Windows methods failed. Helper: ${e1.message} | PS: ${e2.message}`));
                }
            }
            return;
        }

        // ── Method 3: Linux/Mac USB direct write ──
        if (hasDevice && !isWin) {
            try {
                fs.writeFileSync(printerConfig.device, buffer);
                resolve({ success: true, method: 'usb', target: printerConfig.device });
            } catch (err) {
                reject(new Error(`USB: ${err.message}`));
            }
            return;
        }

        // Windows with device but no printerName
        if (isWin && hasDevice && !hasName) {
            reject(new Error('Windows USB requires "Windows Printer Name" (e.g. POS-80C). Device path alone does not work on Windows.'));
            return;
        }

        reject(new Error('No suitable print method'));
    });
}

// ─── Send via compiled .exe helper (fast: ~0.1s) ───
function sendViaHelper(printerName, buffer) {
    return new Promise((resolve, reject) => {
        const { execFile } = require('child_process');

        let exePath;
        try {
            exePath = ensureHelper();
        } catch (e) {
            return reject(e);
        }

        // Write binary data to temp file
        const tmpFile = path.join(os.tmpdir(), 'thebap_' + Date.now() + '.bin');
        fs.writeFileSync(tmpFile, buffer);

        execFile(exePath, [printerName, tmpFile], { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) => {
            // Clean up
            try { fs.unlinkSync(tmpFile); } catch(e) {}

            if (err) {
                reject(new Error(`Helper: ${stderr || err.message}`));
            } else {
                const out = stdout.trim();
                console.log('[Printer] Helper OK:', out, '→', printerName);
                resolve({ success: true, method: 'helper', target: printerName, output: out });
            }
        });
    });
}

// ─── Send via PowerShell (fallback, slower: ~2s) ───
function sendViaPowerShell(printerName, buffer) {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');

        const byteArr = Array.from(buffer).join(',');
        const scriptPath = path.join(os.tmpdir(), 'thebap_ps_' + Date.now() + '.ps1');
        const ps1 = `param([string]$P)
$ErrorActionPreference='Stop'
Add-Type @"
using System;using System.Runtime.InteropServices;
public class RP{
[StructLayout(LayoutKind.Sequential)]public struct DI{[MarshalAs(UnmanagedType.LPStr)]public string n;[MarshalAs(UnmanagedType.LPStr)]public string o;[MarshalAs(UnmanagedType.LPStr)]public string d;}
[DllImport("winspool.Drv",SetLastError=true,CharSet=CharSet.Unicode)]public static extern bool OpenPrinter(string p,out IntPtr h,IntPtr d);
[DllImport("winspool.Drv",SetLastError=true)]public static extern bool StartDocPrinter(IntPtr h,int l,ref DI d);
[DllImport("winspool.Drv",SetLastError=true)]public static extern bool StartPagePrinter(IntPtr h);
[DllImport("winspool.Drv",SetLastError=true)]public static extern bool WritePrinter(IntPtr h,IntPtr b,int c,out int w);
[DllImport("winspool.Drv",SetLastError=true)]public static extern bool EndPagePrinter(IntPtr h);
[DllImport("winspool.Drv",SetLastError=true)]public static extern bool EndDocPrinter(IntPtr h);
[DllImport("winspool.Drv",SetLastError=true)]public static extern bool ClosePrinter(IntPtr h);
}
"@
$b=[byte[]]@(${byteArr});$h=[IntPtr]::Zero
if(-not [RP]::OpenPrinter($P,[ref]$h,[IntPtr]::Zero)){throw "OpenPrinter failed:$P"}
try{$di=New-Object RP+DI;$di.n="TheBap";$di.d="RAW"
[RP]::StartDocPrinter($h,1,[ref]$di)|Out-Null;[RP]::StartPagePrinter($h)|Out-Null
$p=[Runtime.InteropServices.Marshal]::AllocCoTaskMem($b.Length);[Runtime.InteropServices.Marshal]::Copy($b,0,$p,$b.Length)
$w=0;[RP]::WritePrinter($h,$p,$b.Length,[ref]$w)|Out-Null;[Runtime.InteropServices.Marshal]::FreeCoTaskMem($p)
[RP]::EndPagePrinter($h)|Out-Null;[RP]::EndDocPrinter($h)|Out-Null;Write-Output "OK:$w"
}finally{[RP]::ClosePrinter($h)|Out-Null}`;

        fs.writeFileSync(scriptPath, ps1, 'utf8');
        exec(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -P "${printerName}"`,
            { windowsHide: true, timeout: 15000 },
            (err, stdout, stderr) => {
                try { fs.unlinkSync(scriptPath); } catch(e) {}
                if (err) {
                    reject(new Error(`PS: ${stderr || err.message}`));
                } else {
                    console.log('[Printer] PowerShell OK:', stdout.trim(), '→', printerName);
                    resolve({ success: true, method: 'powershell', target: printerName, output: stdout.trim() });
                }
            }
        );
    });
}

// ─── Legacy compatibility ───
function openDrawerViaSpooler(printerName) {
    const buffer = toEscPosBuffer(buildOpenDrawer());
    return sendViaHelper(printerName, buffer).catch(() => sendViaPowerShell(printerName, buffer));
}

module.exports = {
    buildOrderReceipt,
    buildReportReceipt,
    buildOpenDrawer,
    sendToPrinter,
    sendViaHelper,
    sendViaPowerShell,
    openDrawerViaSpooler,
    ensureHelper,
    toEscPosBuffer,
    setCodepage,
    CODEPAGE_MAP,
    CMD,
};
