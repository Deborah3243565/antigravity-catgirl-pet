import os
import sys
import json
import time
import queue
import sqlite3
import mimetypes
import threading
import subprocess
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from datetime import datetime

# 历史用量缓存（8秒刷新一次，避免高频全盘扫描）
_history_cache = {
    "last_computed": 0,
    "today": "0 tok",
    "month": "0 tok",
    "cacheRate": "95.0%"
}

# 实时任务与状态追踪器
_task_tracker = {
    "last_poll": 0,
    "running_map": {},       # cid -> {"id": cid, "title": title, "workspace": ws, "prompt": prompt}
    "last_completed": None,  # {"id": cid, "title": title, "workspace": ws, "time": ts}
    "initialized": False
}
_tracker_lock = threading.Lock()

def _extract_last_prompt(tpath):
    if not os.path.isfile(tpath):
        return ""
    try:
        fsize = os.path.getsize(tpath)
        with open(tpath, "r", encoding="utf-8", errors="ignore") as f:
            if fsize > 65536:
                f.seek(fsize - 65536)
            lines = f.readlines()
        for line in reversed(lines):
            if "USER_INPUT" in line:
                d = json.loads(line)
                if d.get("type") == "USER_INPUT":
                    c = d.get("content", "")
                    if "<USER_REQUEST>" in c and "</USER_REQUEST>" in c:
                        c = c.split("<USER_REQUEST>", 1)[1].split("</USER_REQUEST>", 1)[0]
                    return " ".join(c.strip().split())[:46]
    except Exception:
        pass
    return ""

def _lookup_conversation_info(cid):
    if not cid:
        return {"id": "", "title": "当前对话任务", "workspace": ""}
    with _tracker_lock:
        if cid in _task_tracker["running_map"]:
            return dict(_task_tracker["running_map"][cid])
    db_path = os.path.join(os.environ.get("USERPROFILE", ""), ".gemini", "antigravity", "conversation_summaries.db")
    if os.path.isfile(db_path):
        try:
            conn = sqlite3.connect(db_path, timeout=1.5)
            cur = conn.cursor()
            row = cur.execute(
                "SELECT title, workspace_uris FROM conversation_summaries WHERE conversation_id = ?",
                (cid,)
            ).fetchone()
            conn.close()
            if row:
                title, ws_json = row
                ws_name = ""
                if ws_json:
                    try:
                        uris = json.loads(ws_json)
                        if uris:
                            u = urllib.parse.unquote(uris[0])
                            ws_name = os.path.basename(u.rstrip("/\\"))
                    except Exception:
                        pass
                return {"id": cid, "title": title or "当前对话任务", "workspace": ws_name}
        except Exception:
            pass
    return {"id": cid, "title": "当前对话任务", "workspace": ""}

def poll_running_tasks():
    now_ts = time.time()
    brain_dir = os.path.join(os.environ.get("USERPROFILE", ""), ".gemini", "antigravity", "brain")
    db_path = os.path.join(os.environ.get("USERPROFILE", ""), ".gemini", "antigravity", "conversation_summaries.db")

    new_running_map = {}
    if os.path.isfile(db_path):
        try:
            conn = sqlite3.connect(db_path, timeout=1.5)
            cur = conn.cursor()
            rows = cur.execute("""
                SELECT conversation_id, title, status, not_fully_idle, workspace_uris, last_modified_time
                FROM conversation_summaries
                WHERE status = 'CASCADE_RUN_STATUS_RUNNING' AND (parent_conversation_id = '' OR parent_conversation_id IS NULL)
                ORDER BY last_modified_time DESC
            """).fetchall()
            conn.close()

            for cid, title, status, not_idle, ws_json, mtime in rows:
                tpath = os.path.join(brain_dir, cid, ".system_generated", "logs", "transcript.jsonl")
                if os.path.isfile(tpath):
                    try:
                        file_mtime = os.path.getmtime(tpath)
                        # 过滤超过 15 分钟未更新且最后一步已无工具调用的陈旧僵尸状态
                        if now_ts - file_mtime > 900:
                            with open(tpath, "r", encoding="utf-8", errors="ignore") as tf:
                                tlines = [l.strip() for l in tf if l.strip()]
                            if tlines:
                                last_step = json.loads(tlines[-1])
                                if last_step.get("type") == "PLANNER_RESPONSE" and not last_step.get("tool_calls"):
                                    continue
                    except Exception:
                        pass

                ws_name = ""
                if ws_json:
                    try:
                        uris = json.loads(ws_json)
                        if uris:
                            u = urllib.parse.unquote(uris[0])
                            ws_name = os.path.basename(u.rstrip("/\\"))
                    except Exception:
                        pass

                prompt = _extract_last_prompt(tpath)
                fallback_title = title or (prompt[:18] + "..." if len(prompt) > 18 else prompt) or (f"{ws_name}对话" if ws_name else "正在执行的任务")
                new_running_map[cid] = {
                    "id": cid,
                    "title": fallback_title,
                    "workspace": ws_name,
                    "prompt": prompt
                }
        except Exception:
            with _tracker_lock:
                return list(_task_tracker["running_map"].values())

    with _tracker_lock:
        if _task_tracker["initialized"]:
            for old_cid, old_task in _task_tracker["running_map"].items():
                if old_cid not in new_running_map:
                    # 检测到某个对话任务刚刚完成！
                    _task_tracker["last_completed"] = {
                        "id": old_cid,
                        "title": old_task.get("title", "对话任务"),
                        "workspace": old_task.get("workspace", ""),
                        "time": now_ts
                    }
        _task_tracker["running_map"] = new_running_map
        _task_tracker["initialized"] = True
        _task_tracker["last_poll"] = now_ts
        return list(new_running_map.values())

def get_native_stats(override_pct=None):
    now_ts = time.time()
    brain_dir = os.path.join(os.environ.get("USERPROFILE", ""), ".gemini", "antigravity", "brain")

    # 1. 实时扫描正在运行的任务列表
    running_tasks = poll_running_tasks()

    ctx_tokens = 0
    ctx_pct = 0
    model_name = "Gemini"

    if os.path.exists(brain_dir):
        transcripts = []
        try:
            for entry in os.scandir(brain_dir):
                if entry.is_dir():
                    tpath = os.path.join(entry.path, ".system_generated", "logs", "transcript.jsonl")
                    if os.path.isfile(tpath):
                        transcripts.append(tpath)
        except Exception:
            pass

        # 查找最新活跃会话提取当前上下文占用
        if transcripts:
            latest = max(transcripts, key=os.path.getmtime)
            try:
                fsize = os.path.getsize(latest)
                with open(latest, "r", encoding="utf-8", errors="ignore") as f:
                    if fsize > 32768:
                        f.seek(fsize - 32768)
                    lines = f.readlines()
                for line in reversed(lines):
                    if "PLANNER_RESPONSE" in line:
                        d = json.loads(line)
                        inp = d.get("input_tokens", 0)
                        cache = d.get("cache_read_tokens", 0)
                        ctx_tokens = inp + cache
                        ctx_pct = min(100, max(1, round(ctx_tokens / 262144 * 100)))
                        break
            except Exception:
                pass

    if override_pct is not None and 0 < override_pct <= 100:
        ctx_pct = override_pct

        # 汇总今日与本月历史用量（每 8 秒刷新一次缓存）
        if now_ts - _history_cache["last_computed"] >= 8.0:
            now = datetime.now()
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()

            today_input = 0
            today_cache = 0
            today_output = 0
            month_tokens = 0

            for p in transcripts:
                try:
                    mtime = os.path.getmtime(p)
                    if mtime >= month_start:
                        with open(p, "r", encoding="utf-8", errors="ignore") as f:
                            for line in f:
                                if "PLANNER_RESPONSE" in line:
                                    d = json.loads(line)
                                    inp = d.get("input_tokens", 0)
                                    cache = d.get("cache_read_tokens", 0)
                                    out = d.get("output_tokens", 0)
                                    step_total = inp + cache + out
                                    month_tokens += step_total
                                    if mtime >= today_start:
                                        today_input += inp
                                        today_cache += cache
                                        today_output += out
                except Exception:
                    pass

            today_total = today_input + today_cache + today_output
            cache_rate = round(today_cache / (today_cache + today_input) * 100, 1) if (today_cache + today_input) > 0 else 95.0

            def fmt(n):
                if n >= 1_000_000:
                    return f"{n / 1_000_000:.1f}M tok"
                elif n >= 1_000:
                    return f"{n / 1_000:.1f}K tok"
                return f"{n} tok"

            _history_cache["today"] = fmt(today_total)
            _history_cache["month"] = fmt(month_tokens)
            _history_cache["cacheRate"] = f"{cache_rate}%"
            _history_cache["last_computed"] = now_ts

    def fmt_ctx(n):
        if n >= 1_000:
            return f"{n / 1_000:.1f}K"
        return str(n)

    # 2. 严格按照状态机规则计算当前权威自动姿态 (autoState)
    # 规则：
    # - 庆祝 (celebrate): 仅在某一个对话中的任务刚完成时出现（持续 4.5 秒）
    # - 预警 (warning): 在上下文窗口高于 80% 时出现
    # - 敲码 (coding): 在有任务正在运行时出现
    # - 待机 (idle): 在没有任务运行时出现
    # - 思考 (thinking): 不在任务运行时出现，仅作为前端点按桌宠时的彩蛋出现
    auto_state = "idle"
    auto_detail = ""
    completed_task = None

    with _tracker_lock:
        last_comp = _task_tracker["last_completed"]
        if last_comp and (now_ts - last_comp["time"] < 4.5):
            completed_task = dict(last_comp)

    if completed_task:
        auto_state = "celebrate"
        auto_detail = f"🎉 任务搞定啦：《{completed_task['title']}》✨"
    elif ctx_pct >= 80:
        auto_state = "warning"
        auto_detail = f"💦 上下文已达 {ctx_pct}%！快用 /compact 压缩~"
    elif len(running_tasks) > 0:
        auto_state = "coding"
        auto_detail = f"⚡ 正在敲码：《{running_tasks[0]['title']}》"
    else:
        auto_state = "idle"
        auto_detail = ""

    return {
        "mode": "native",
        "contextTokens": fmt_ctx(ctx_tokens),
        "contextTokensRaw": ctx_tokens,
        "contextPercent": ctx_pct,
        "contextLimit": "256K tok",
        "model": model_name,
        "today": _history_cache["today"],
        "month": _history_cache["month"],
        "cacheRate": _history_cache["cacheRate"],
        "tps": "118.4 tok/s",
        "fiveBalance": "健康充裕",
        "fiveCountdown": "原生自适应",
        "weekBalance": "正常",
        "weekCountdown": "独立模式",
        "runningTasks": running_tasks,
        "autoState": auto_state,
        "autoDetail": auto_detail,
        "completedTask": completed_task
    }


# 端口优先级：环境变量 ANTIGRAVITY_SIDECAR_WEB_PORT -> 18980
DEFAULT_PORT = 18980
PORT = int(os.environ.get("ANTIGRAVITY_SIDECAR_WEB_PORT", DEFAULT_PORT))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT_FILE = os.path.join(BASE_DIR, ".port")

# 全局共享状态与 SSE 队列
current_state = {
    "state": "idle",
    "detail": "随时待命",
    "tokens": 42000,
    "timestamp": time.time()
}
sse_subscribers = []

mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("image/webp", ".webp")

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class PetRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # 保持静默，避免刷屏
        pass

    def send_file_with_range(self, file_path, mime_type):
        try:
            file_size = os.path.getsize(file_path)
            range_header = self.headers.get('Range')
            if range_header and range_header.startswith("bytes="):
                range_spec = range_header[6:].strip()
                if "-" in range_spec:
                    parts = range_spec.split("-", 1)
                    start = int(parts[0]) if parts[0] else 0
                    end = int(parts[1]) if parts[1] else file_size - 1
                else:
                    start = int(range_spec)
                    end = file_size - 1
                start = max(0, min(start, file_size - 1))
                end = max(start, min(end, file_size - 1))
                length = end - start + 1
                self.send_response(206)
                self.send_header("Content-Type", mime_type or "application/octet-stream")
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(length))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "public, max-age=86400")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                with open(file_path, "rb") as f:
                    f.seek(start)
                    rem = length
                    while rem > 0:
                        chunk = f.read(min(rem, 65536))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        rem -= len(chunk)
                return

            self.send_response(200)
            self.send_header("Content-Type", mime_type or "application/octet-stream")
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (ConnectionResetError, BrokenPipeError):
            pass
        except Exception as e:
            try:
                self.send_error(500, str(e))
            except Exception:
                pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def do_GET(self):
        clean_path = self.path.split("?")[0]

        # 1. 静态主页
        if clean_path in ["", "/"]:
            index_path = os.path.join(BASE_DIR, "index.html")
            if os.path.exists(index_path):
                with open(index_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(content)
                self.wfile.flush()
                self.close_connection = True
                return

        # 2. 静态切片与动作 WebM 视频/WebP 序列资源
        if clean_path.startswith("/assets/"):
            rel_subpath = urllib.parse.unquote(clean_path[len("/assets/"):].lstrip("/"))
            candidates = [
                os.path.join(BASE_DIR, "assets", rel_subpath),
                os.path.join(BASE_DIR, "..", "..", "assets", rel_subpath),
                os.path.join(os.path.expanduser("~"), ".gemini", "config", "plugins", "antigravity-catgirl-pet", "assets", rel_subpath)
            ]
            for cand in candidates:
                cand_path = os.path.normpath(cand)
                if os.path.isfile(cand_path):
                    mime, _ = mimetypes.guess_type(cand_path)
                    if cand_path.endswith(".webm"):
                        mime = "video/webm"
                    elif cand_path.endswith(".webp"):
                        mime = "image/webp"
                    self.send_file_with_range(cand_path, mime)
                    return
            self.send_error(404, "Asset Not Found")
            return

        # 3.5 原生统计与实时任务接口
        if clean_path == "/api/stats":
            override_pct = None
            try:
                parsed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                if "host_ctx_pct" in parsed_qs:
                    val = int(parsed_qs["host_ctx_pct"][0])
                    if 0 < val <= 100:
                        override_pct = val
            except Exception:
                pass
            stats = get_native_stats(override_pct=override_pct)
            payload = json.dumps(stats, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(payload)
            self.wfile.flush()
            self.close_connection = True
            return

        # 3. 获取当前状态接口
        if clean_path == "/api/state":
            payload = json.dumps(current_state).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(payload)
            self.wfile.flush()
            self.close_connection = True
            return

        # 4. SSE 实时事件流
        if clean_path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            q = queue.Queue()
            sse_subscribers.append(q)
            initial_msg = f"data: {json.dumps(current_state)}\n\n".encode("utf-8")
            self.wfile.write(initial_msg)
            self.wfile.flush()

            try:
                while True:
                    try:
                        msg = q.get(timeout=20)
                        self.wfile.write(msg)
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": heartbeat\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                if q in sse_subscribers:
                    sse_subscribers.remove(q)
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        clean_path = self.path.split("?")[0]
        if clean_path == "/api/event":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                req_state = data.get("state", current_state["state"])
                # 思考姿态不在任务运行时出现，自动转为 coding
                if req_state == "thinking":
                    req_state = "coding"

                cid = data.get("conversationId", "")
                detail = data.get("detail", "")

                if req_state == "celebrate":
                    info = _lookup_conversation_info(cid)
                    with _tracker_lock:
                        _task_tracker["last_completed"] = {
                            "id": cid or info.get("id", ""),
                            "title": info.get("title", "当前对话任务"),
                            "workspace": info.get("workspace", ""),
                            "time": time.time()
                        }
                        if cid and cid in _task_tracker["running_map"]:
                            del _task_tracker["running_map"][cid]
                    if not detail:
                        detail = f"🎉 任务搞定啦：《{info.get('title', '当前对话任务')}》✨"

                current_state["state"] = req_state
                if detail:
                    current_state["detail"] = detail
                if "tokens" in data:
                    current_state["tokens"] = data["tokens"]
                current_state["timestamp"] = time.time()

                # 广播给 SSE 连接
                event_data = f"data: {json.dumps(current_state)}\n\n".encode("utf-8")
                for q in list(sse_subscribers):
                    try:
                        q.put_nowait(event_data)
                    except Exception:
                        pass

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
                self.wfile.flush()
                self.close_connection = True
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(str(e).encode("utf-8"))
                self.wfile.flush()
                self.close_connection = True
            return

        self.send_response(404)
        self.end_headers()

def start_cdp_watchdog():
    def watchdog_loop():
        candidates = [
            os.path.normpath(os.path.join(BASE_DIR, "..", "..", "scripts", "inject_pet.js")),
            os.path.normpath(os.path.join(os.path.expanduser("~"), ".gemini", "config", "plugins", "antigravity-catgirl-pet", "scripts", "inject_pet.js"))
        ]
        script_path = None
        for c in candidates:
            if os.path.exists(c):
                script_path = c
                break
        if not script_path:
            return

        flags = 0
        if sys.platform == "win32":
            flags = 0x08000000  # CREATE_NO_WINDOW

        time.sleep(2.5)
        last_cdp_port = None

        while True:
            try:
                port_file = os.path.join(os.environ.get("APPDATA", ""), "Antigravity", "DevToolsActivePort")
                if os.path.exists(port_file):
                    with open(port_file, "r", encoding="utf-8") as f:
                        current_port = f.readline().strip()

                    if last_cdp_port is None or current_port != last_cdp_port:
                        last_cdp_port = current_port
                        time.sleep(2)
                        subprocess.run(["node", script_path], capture_output=True, timeout=12, creationflags=flags)
                        time.sleep(4)
                        continue

                    res = subprocess.run(["node", script_path, "--ensure"], capture_output=True, timeout=10, creationflags=flags)
                    out = res.stdout.decode("utf-8", errors="ignore") if res.stdout else ""
                    if "未挂载" in out or res.returncode != 0:
                        time.sleep(1)
                        subprocess.run(["node", script_path], capture_output=True, timeout=12, creationflags=flags)
            except Exception:
                pass
            time.sleep(4)

    t = threading.Thread(target=watchdog_loop, daemon=True)
    t.start()

def main():
    # 单实例锁：防止多实例孤儿进程争抢 CDP 端口
    if sys.platform == "win32":
        try:
            import msvcrt
            lock_path = os.path.join(BASE_DIR, ".server.lock")
            lock_fd = open(lock_path, "w")
            msvcrt.locking(lock_fd.fileno(), msvcrt.LK_NBLCK, 1)
        except Exception:
            sys.exit(0)

    try:
        server = ThreadedHTTPServer(("127.0.0.1", PORT), PetRequestHandler)
    except OSError:
        server = ThreadedHTTPServer(("127.0.0.1", 0), PetRequestHandler)
    
    actual_port = server.server_address[1]
    with open(PORT_FILE, "w", encoding="utf-8") as f:
        f.write(str(actual_port))

    start_cdp_watchdog()

    print(f"[星星猫娘桌宠] Sidecar Web 服务启动成功: http://127.0.0.1:{actual_port}")
    sys.stdout.flush()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if os.path.exists(PORT_FILE):
            try:
                os.remove(PORT_FILE)
            except OSError:
                pass

if __name__ == "__main__":
    main()
