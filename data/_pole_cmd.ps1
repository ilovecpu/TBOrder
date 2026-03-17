
$ErrorActionPreference = 'Stop'
$log = @()
try {
    $log += "Opening COM3 at 9600bps..."
    $sp = New-Object System.IO.Ports.SerialPort
    $sp.PortName = 'COM3'
    $sp.BaudRate = 9600
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
    $b1 = [byte[]]@(0x54,0x68,0x61,0x6E,0x6B,0x20,0x79,0x6F,0x75,0x20,0x66,0x6F,0x72,0x20,0x56,0x69,0x73,0x69,0x74,0x69)
    $b2 = [byte[]]@(0x6E,0x67,0x21,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x20)
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
