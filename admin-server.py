#!/usr/bin/env python3
"""
🍚 The Bap Admin Server v1.2
Admin용 경량 서버 — Google Apps Script 프록시 포함
CORS 문제 없이 어디서든 Admin 실행 가능!
"""
import http.server, json, urllib.request, urllib.parse, os, sys

PORT = 9000
GOOGLE_API = 'https://script.google.com/macros/s/AKfycbzBrKnJg4ypsgDjP9HA6n7k23HgsG1IECGtJUwdy6Wx_n64QcihwxaEzLNOc4EmWtZHsQ/exec'

class AdminHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # /google?action=menu → Google Apps Script 프록시
        if self.path.startswith('/google'):
            query = self.path.split('?', 1)[1] if '?' in self.path else 'action=menu'
            url = GOOGLE_API + '?' + query
            try:
                req = urllib.request.Request(url)
                req.add_header('User-Agent', 'TBAdmin/1.2')
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
            return
        # 나머지는 정적 파일 서빙
        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/google'):
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length > 0 else b''
            try:
                req = urllib.request.Request(
                    GOOGLE_API,
                    data=body,
                    headers={
                        'Content-Type': 'application/json',
                        'User-Agent': 'TBAdmin/1.2'
                    },
                    method='POST'
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
            return
        self.send_response(405)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        if '/google' in str(args[0]):
            print(f'  ☁️  Google API: {args[0]}')

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f'''
  ╔════════════════════════════════════════════╗
  ║  🍚 The Bap Admin Server v1.2             ║
  ║  http://localhost:{PORT}/TBMain_Kiosk.html      ║
  ╚════════════════════════════════════════════╝
  Google API 프록시 활성화
  종료: Ctrl+C
''')
http.server.HTTPServer(('', PORT), AdminHandler).serve_forever()
