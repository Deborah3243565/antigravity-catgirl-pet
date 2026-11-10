import os
import sys
import json
import threading
import webview
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_PATH = os.path.join(BASE_DIR, "pet_window.html")
PORT_FILE = os.path.join(BASE_DIR, ".port")

# 全局窗口引用与端口
app_window = None
DEFAULT_PORT = 18980

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class EventBridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        global app_window
        clean_path = self.path.split("?")[0]
        if clean_path == "/api/event":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                # 跨线程调度到 WebView 前端
                if app_window is not None:
                    js_code = f"window.applyState && window.applyState({json.dumps(data)});"
                    app_window.evaluate_js(js_code)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(e).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

def start_http_server():
    global DEFAULT_PORT
    server = None
    for port in [18980, 18981, 18982, 0]:
        try:
            server = ThreadedHTTPServer(("127.0.0.1", port), EventBridgeHandler)
            DEFAULT_PORT = server.server_address[1]
            break
        except OSError:
            continue

    if server:
        # 写入端口文件供 Antigravity Hook 读取
        with open(PORT_FILE, "w", encoding="utf-8") as f:
            f.write(str(DEFAULT_PORT))
        
        # 同时同步到全局插件目录，保证 Hook 即使在其它目录也能命中
        global_plugin_dir = os.path.expanduser(r"~\.gemini\config\plugins\antigravity-catgirl-pet")
        if os.path.exists(global_plugin_dir):
            try:
                with open(os.path.join(global_plugin_dir, ".port"), "w", encoding="utf-8") as f:
                    f.write(str(DEFAULT_PORT))
            except Exception:
                pass

        print(f"[星星猫娘桌宠] 本地监听服务已就绪: 127.0.0.1:{DEFAULT_PORT}")
        server.serve_forever()

class JsApi:
    def close(self):
        if app_window:
            app_window.destroy()

def main():
    global app_window

    # 1. 启动后台事件监听线程
    server_thread = threading.Thread(target=start_http_server, daemon=True)
    server_thread.start()

    # 2. 计算屏幕右下角坐标
    win_w, win_h = 240, 340
    screen_w, screen_h = 1536, 864
    try:
        screens = webview.screens
        if screens and len(screens) > 0:
            screen_w = screens[0].width
            screen_h = screens[0].height
    except Exception:
        pass

    pos_x = max(20, screen_w - win_w - 30)
    pos_y = max(20, screen_h - win_h - 60)

    # 3. 创建独立桌面透明悬浮窗口
    api = JsApi()
    app_window = webview.create_window(
        title="Gemini Star Catgirl",
        url=HTML_PATH,
        js_api=api,
        width=win_w,
        height=win_h,
        x=pos_x,
        y=pos_y,
        frameless=True,       # 无边框
        transparent=True,     # 背景彻底透明
        on_top=True,          # 永远置顶
        resizable=False
    )

    print("[星星猫娘桌宠] 桌面透明悬浮挂件正在启动...")
    try:
        webview.start(debug=False)
    finally:
        # 清理端口文件
        if os.path.exists(PORT_FILE):
            try:
                os.remove(PORT_FILE)
            except OSError:
                pass

if __name__ == "__main__":
    main()
