import os
import re
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
from datetime import datetime, timedelta
from collections import deque
import statistics

# 历史用量缓存（8秒刷新一次，避免高频全盘扫描）
_history_cache = {
    "last_computed": 0,
    "today": "0 tok",
    "month": "0 tok",
    "cacheRate": "95.0%"
}

# 全量按日/按模型分析缓存（20秒刷新一次，支持手动 force 刷新）
_analytics_cache = {
    "last_computed": 0,
    "data": None
}
_analytics_lock = threading.Lock()

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

_MODEL_TAIL_RE = re.compile(rb'(?:Gemini [0-9][^\x00-\x1f"]{2,35}|Claude [^\x00-\x1f"]{2,35}|GPT[^\x00-\x1f"]{2,35})')
_STEP_IDX_RE = re.compile(rb'last_step_index[^\d]{1,10}(\d+)')

def _clean_model_name(raw, keep_tier=False):
    s = (raw or "").strip()
    if not s:
        return "Gemini 3.8 Flash"
    if "GPT_OSS_120B" in s.upper():
        return "GPT-OSS 120B"
    if not keep_tier:
        s = re.sub(r'\s*\((?:High|Medium|Low|Minimal|Thinking)\)\s*$', '', s, flags=re.I).strip()
    return s

def _load_conv_step_models(cid, keep_tier=False):
    step_models = []
    if not cid or cid == "none":
        return step_models
    conv_dir = os.path.join(os.environ.get("USERPROFILE", ""), ".gemini", "antigravity", "conversations")
    dbp = os.path.join(conv_dir, cid + ".db")
    if not os.path.isfile(dbp):
        return step_models
    try:
        conn = sqlite3.connect(f"file:{dbp}?mode=ro", uri=True, timeout=1.5)
        rows = conn.execute("SELECT idx, substr(data, max(1, length(data)-750)) FROM gen_metadata ORDER BY idx ASC").fetchall()
        conn.close()
        for idx, tail in rows:
            if not tail:
                continue
            if isinstance(tail, str):
                tail = tail.encode("latin1", errors="ignore")
            m_mod = _MODEL_TAIL_RE.findall(tail)
            if m_mod:
                m_step = _STEP_IDX_RE.search(tail)
                s_idx = int(m_step.group(1)) if m_step else idx * 2
                step_models.append((s_idx, _clean_model_name(m_mod[-1].decode("utf-8", "ignore"), keep_tier=keep_tier)))
        step_models.sort(key=lambda x: x[0])
    except Exception:
        pass
    return step_models

def get_analytics_data(force=False):
    now_ts = time.time()
    with _analytics_lock:
        if not force and _analytics_cache["data"] is not None and (now_ts - _analytics_cache["last_computed"] < 20.0):
            return _analytics_cache["data"]

    brain_dir = os.path.join(os.environ.get("USERPROFILE", ""), ".gemini", "antigravity", "brain")
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    week_start_dt = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_ts = week_start_dt.timestamp()
    today_start_ts = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    month_start_ts = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()

    daily = {}
    model_totals = {}
    years_set = {now.year}

    today_tok = today_req = 0
    week_tok = week_req = 0
    month_tok = month_req = 0
    all_tok = all_req = 0

    if os.path.exists(brain_dir):
        try:
            entries = [e for e in os.scandir(brain_dir) if e.is_dir()]
        except Exception:
            entries = []

        for entry in entries:
            tp = os.path.join(entry.path, ".system_generated", "logs", "transcript.jsonl")
            if not os.path.isfile(tp):
                continue
            cid = entry.name
            step_models = _load_conv_step_models(cid, keep_tier=False)
            default_mod = step_models[-1][1] if step_models else "Gemini 3.8 Flash"
            sm_i = 0

            try:
                mtime = os.path.getmtime(tp)
                with open(tp, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if "PLANNER_RESPONSE" not in line:
                            continue
                        try:
                            d = json.loads(line)
                        except Exception:
                            continue
                        inp = int(d.get("input_tokens", 0) or 0)
                        cache_r = int(d.get("cache_read_tokens", 0) or 0)
                        cache_w = int(d.get("cache_creation_tokens", 0) or 0)
                        out = int(d.get("output_tokens", 0) or 0)
                        tot = inp + cache_r + cache_w + out
                        if tot <= 0:
                            continue

                        s_idx = int(d.get("step_index", 0) or 0)
                        while sm_i + 1 < len(step_models) and step_models[sm_i + 1][0] <= s_idx:
                            sm_i += 1
                        mod = step_models[sm_i][1] if step_models else default_mod

                        ca = d.get("created_at")
                        if ca:
                            try:
                                dt = datetime.fromisoformat(ca.replace("Z", "+00:00")).astimezone()
                                step_ts = dt.timestamp()
                                day_key = dt.strftime("%Y-%m-%d")
                                years_set.add(dt.year)
                            except Exception:
                                dt = datetime.fromtimestamp(mtime)
                                step_ts = mtime
                                day_key = dt.strftime("%Y-%m-%d")
                        else:
                            dt = datetime.fromtimestamp(mtime)
                            step_ts = mtime
                            day_key = dt.strftime("%Y-%m-%d")

                        all_tok += tot
                        all_req += 1
                        if step_ts >= month_start_ts:
                            month_tok += tot
                            month_req += 1
                        if step_ts >= week_start_ts:
                            week_tok += tot
                            week_req += 1
                        if step_ts >= today_start_ts:
                            today_tok += tot
                            today_req += 1

                        if day_key not in daily:
                            daily[day_key] = {
                                "total": 0, "requests": 0,
                                "input": 0, "cacheRead": 0, "cacheWrite": 0, "output": 0,
                                "byModel": {}
                            }
                        dd = daily[day_key]
                        dd["total"] += tot
                        dd["requests"] += 1
                        dd["input"] += inp
                        dd["cacheRead"] += cache_r
                        dd["cacheWrite"] += cache_w
                        dd["output"] += out

                        if mod not in dd["byModel"]:
                            dd["byModel"][mod] = {"total": 0, "requests": 0, "input": 0, "cacheRead": 0, "cacheWrite": 0, "output": 0}
                        dm = dd["byModel"][mod]
                        dm["total"] += tot
                        dm["requests"] += 1
                        dm["input"] += inp
                        dm["cacheRead"] += cache_r
                        dm["cacheWrite"] += cache_w
                        dm["output"] += out

                        model_totals[mod] = model_totals.get(mod, 0) + tot
            except Exception:
                pass

    models_sorted = sorted(model_totals.keys(), key=lambda m: model_totals[m], reverse=True)
    result = {
        "generatedAt": now.strftime("%Y-%m-%d %H:%M:%S"),
        "todayStr": today_str,
        "summary": {
            "today": today_tok, "todayRequests": today_req,
            "week": week_tok, "weekRequests": week_req,
            "month": month_tok, "monthRequests": month_req,
            "allTime": all_tok, "allTimeRequests": all_req
        },
        "models": models_sorted,
        "years": sorted(years_set, reverse=True),
        "daily": daily
    }
    with _analytics_lock:
        _analytics_cache["data"] = result
        _analytics_cache["last_computed"] = time.time()
    return result

def get_native_stats(override_pct=None, conversation_id=None):
    now_ts = time.time()
    brain_dir = os.path.join(os.environ.get("USERPROFILE", ""), ".gemini", "antigravity", "brain")

    # 1. 实时扫描正在运行的任务列表
    running_tasks = poll_running_tasks()

    ctx_tokens = 0
    ctx_pct = 0
    conv_total_tokens = 0
    conv_requests = 0
    real_tps = "--"
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

        # 确定目标会话日志：优先精确匹配前端当前所在对话框的 conversation_id
        target_transcript = None
        if conversation_id == "none":
            target_transcript = None
        elif conversation_id:
            cand = os.path.join(brain_dir, conversation_id, ".system_generated", "logs", "transcript.jsonl")
            if os.path.isfile(cand):
                target_transcript = cand
        elif transcripts:
            target_transcript = max(transcripts, key=os.path.getmtime)

        # 提取目标会话当前上下文占用与真实生成速率 (tok/s)
        real_tps = "--"
        if target_transcript:
            # 获取当前对话最新使用的具体模型名
            try:
                target_cid = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(target_transcript))))
                c_mods = _load_conv_step_models(target_cid, keep_tier=True)
                if c_mods:
                    model_name = c_mods[-1][1]
            except Exception:
                pass
            try:
                # 全量扫描当前对话框日志，统计完整累计 Token 总量、请求数，同时提取末尾上下文与生成速率
                tail_lines = deque(maxlen=120)
                with open(target_transcript, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        tail_lines.append(line)
                        if "PLANNER_RESPONSE" in line or '"CHECKPOINT"' in line:
                            try:
                                d = json.loads(line)
                                stype = d.get("type")
                                if stype == "PLANNER_RESPONSE":
                                    inp = int(d.get("input_tokens", 0) or 0)
                                    cache_r = int(d.get("cache_read_tokens", 0) or 0)
                                    cache_w = int(d.get("cache_creation_tokens", 0) or 0)
                                    out = int(d.get("output_tokens", 0) or 0)
                                    conv_total_tokens += inp + cache_r + cache_w + out
                                    conv_requests += 1
                                    ctx_tokens = inp + cache_r
                                elif stype == "CHECKPOINT" and d.get("status") == "DONE":
                                    # /compact 完成后 Antigravity 只写 CHECKPOINT 不写 PLANNER_RESPONSE；
                                    # CHECKPOINT 的 input/cache_read 是压缩前上下文，压缩后的新上下文为摘要 output_tokens + 系统提示基线
                                    out = int(d.get("output_tokens", 0) or 0)
                                    ctx_tokens = max(out + 20000, 12000)
                            except Exception:
                                pass
                ctx_pct = min(100, max(1, round(ctx_tokens / 262144 * 100))) if ctx_tokens > 0 else 0
                # 基于最近有效步骤的 output_tokens 与时间差，过滤整秒取整(dt<2s)及异常尖峰后取中位速率
                prev_ts = None
                step_tps_samples = []
                for line in tail_lines:
                    try:
                        d = json.loads(line)
                        ca = d.get("created_at")
                        ts = datetime.fromisoformat(ca.replace("Z", "+00:00")).timestamp() if ca else None
                        out_tok = d.get("output_tokens")
                        if d.get("type") == "PLANNER_RESPONSE" and out_tok and prev_ts and ts:
                            dt = ts - prev_ts
                            if 2.0 <= dt <= 120.0:
                                step_tps = out_tok / dt
                                if 1.0 <= step_tps <= 350.0:
                                    step_tps_samples.append(step_tps)
                        if ts:
                            prev_ts = ts
                    except Exception:
                        pass
                if step_tps_samples:
                    real_tps = f"{round(statistics.median(step_tps_samples), 1)} tok/s"
            except Exception:
                pass

        # 汇总今日与本月历史用量（每 8 秒刷新一次缓存，按每条记录 created_at 精确归档）
        if transcripts and now_ts - _history_cache["last_computed"] >= 8.0:
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
                                    ca = d.get("created_at")
                                    if ca:
                                        try:
                                            step_ts = datetime.fromisoformat(ca.replace("Z", "+00:00")).timestamp()
                                        except Exception:
                                            step_ts = mtime
                                    else:
                                        step_ts = mtime
                                    if step_ts >= month_start:
                                        month_tokens += step_total
                                    if step_ts >= today_start:
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

    if override_pct is not None and 0 < override_pct <= 100:
        ctx_pct = override_pct

    def fmt_ctx(n):
        if n >= 1_000:
            return f"{n / 1_000:.1f}K"
        return str(n)

    def fmt_tok_total(n):
        if n >= 1_000_000:
            return f"{n / 1_000_000:.1f}M tok"
        elif n >= 1_000:
            return f"{n / 1_000:.1f}K tok"
        return f"{n} tok"

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
        auto_detail = f"任务完成：《{completed_task['title']}》"
    elif ctx_pct >= 80:
        auto_state = "warning"
        auto_detail = f"上下文已达 {ctx_pct}%，建议执行 /compact"
    elif len(running_tasks) > 0:
        auto_state = "coding"
        auto_detail = f"正在处理：《{running_tasks[0]['title']}》"
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
        "convTotal": fmt_tok_total(conv_total_tokens),
        "convTotalRaw": conv_total_tokens,
        "convRequests": conv_requests,
        "tps": real_tps,
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

def get_config_paths():
    home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or ""
    paths = []
    if home:
        paths.append(os.path.join(home, ".gemini", "antigravity", "catgirl_pet_config.json"))
        paths.append(os.path.join(home, ".gemini", "config", "plugins", "antigravity-catgirl-pet", "pet_config.json"))
    paths.append(os.path.normpath(os.path.join(BASE_DIR, "..", "..", "pet_config.json")))
    return paths

def load_pet_config():
    for p in get_config_paths():
        if os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except Exception:
                pass
    return {"scale": 1.3}

def save_pet_config(data):
    cfg = load_pet_config()
    if isinstance(data, dict):
        if "scale" in data:
            try:
                s = float(data["scale"])
                cfg["scale"] = round(max(0.4, min(2.5, s)), 2)
            except (ValueError, TypeError):
                pass
        for k, v in data.items():
            if k != "scale":
                cfg[k] = v
    for p in get_config_paths():
        try:
            d = os.path.dirname(os.path.abspath(p))
            if os.path.isdir(d):
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
    return cfg

# 远程版本更新检查与升级执行器
_update_cache = {
    "last_checked": 0,
    "data": None
}

def get_update_script_path():
    candidates = [
        os.path.normpath(os.path.join(BASE_DIR, "..", "..", "scripts", "update_pet.js")),
        os.path.normpath(os.path.join(os.path.expanduser("~"), ".gemini", "config", "plugins", "antigravity-catgirl-pet", "scripts", "update_pet.js"))
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return candidates[0]

def run_update_check(force=False):
    now = time.time()
    if not force and _update_cache["data"] and (now - _update_cache["last_checked"] < 60):
        return _update_cache["data"]

    script = get_update_script_path()
    if not os.path.isfile(script):
        return {"hasUpdate": False, "error": "Updater script not found"}

    try:
        flags = 0x08000000 if sys.platform == "win32" else 0
        res = subprocess.run(["node", script, "--check"], capture_output=True, timeout=15, creationflags=flags)
        out = res.stdout.decode("utf-8", errors="ignore").strip()
        data = json.loads(out)
        _update_cache["data"] = data
        _update_cache["last_checked"] = now
        return data
    except Exception as e:
        return {"hasUpdate": False, "error": str(e)}

def run_apply_upgrade():
    script = get_update_script_path()
    if not os.path.isfile(script):
        return {"success": False, "error": "Updater script not found"}

    try:
        flags = 0x08000000 if sys.platform == "win32" else 0
        res = subprocess.run(["node", script, "--upgrade"], capture_output=True, timeout=60, creationflags=flags)
        out = res.stdout.decode("utf-8", errors="ignore").strip()
        data = json.loads(out)
        _update_cache["data"] = None
        _update_cache["last_checked"] = 0
        return data
    except Exception as e:
        return {"success": False, "error": str(e)}

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
            conversation_id = None
            try:
                parsed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                if "host_ctx_pct" in parsed_qs:
                    val = int(parsed_qs["host_ctx_pct"][0])
                    if 0 < val <= 100:
                        override_pct = val
                if "conversation_id" in parsed_qs and parsed_qs["conversation_id"]:
                    raw_cid = parsed_qs["conversation_id"][0].strip()
                    if raw_cid == "none" or re.fullmatch(r"[0-9a-zA-Z_-]{8,64}", raw_cid):
                        conversation_id = raw_cid
            except Exception:
                pass
            stats = get_native_stats(override_pct=override_pct, conversation_id=conversation_id)
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

        # 3.6 全量按日/按模型用量统计分析接口（支持活动热力图与按模型柱状图明细）
        if clean_path == "/api/analytics":
            force_refresh = False
            try:
                parsed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                force_refresh = parsed_qs.get("refresh", ["0"])[0] in ("1", "true", "yes")
            except Exception:
                pass
            analytics = get_analytics_data(force=force_refresh)
            payload = json.dumps(analytics, ensure_ascii=False).encode("utf-8")
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

        # 3.1 获取持久化配置接口
        if clean_path == "/api/config":
            cfg = load_pet_config()
            payload = json.dumps(cfg, ensure_ascii=False).encode("utf-8")
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

        # 3.2 检查版本更新接口
        if clean_path == "/api/update":
            data = run_update_check(force=False)
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
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
                        detail = f"任务完成：《{info.get('title', '当前对话任务')}》"

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

        if clean_path == "/api/config":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
            try:
                data = json.loads(body)
                cfg = save_pet_config(data)
                payload = json.dumps({"status": "ok", "config": cfg}, ensure_ascii=False).encode("utf-8")
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
            except Exception as e:
                err_content = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err_content)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(err_content)
                self.wfile.flush()
                self.close_connection = True
            return

        # 强制检查新版本接口
        if clean_path == "/api/check-update":
            data = run_update_check(force=True)
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
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

        # 一键拉取更新与自动配置
        if clean_path == "/api/upgrade":
            data = run_apply_upgrade()
            if data.get("success"):
                current_state["state"] = "celebrate"
                ver_text = f" v{data.get('version', '')}" if data.get('version') else ""
                current_state["detail"] = f"已升级至最新版本{ver_text}"
                current_state["timestamp"] = time.time()
                event_data = f"data: {json.dumps(current_state)}\n\n".encode("utf-8")
                for q in list(sse_subscribers):
                    try:
                        q.put_nowait(event_data)
                    except Exception:
                        pass
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
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
