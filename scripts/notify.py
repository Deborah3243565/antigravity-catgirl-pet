import sys
import os
import json
import argparse
import urllib.request

def main():
    parser = argparse.ArgumentParser(description="Antigravity 猫娘桌宠状态通知脚本")
    parser.add_argument("--state", type=str, default="idle", help="猫娘状态 (idle, thinking, coding, celebrate, warning)")
    parser.add_argument("--detail", type=str, default="", help="附加描述或气泡文案")
    parser.add_argument("--tokens", type=int, default=0, help="当前 Token 数")
    args, _ = parser.parse_known_args()

    # 读取 Hook 传入的 stdin JSON 上下文（包含 conversationId、lastUserInput、terminationReason 等）
    hook_ctx = {}
    if not sys.stdin.isatty():
        try:
            raw_in = sys.stdin.read()
            if raw_in and raw_in.strip():
                hook_ctx = json.loads(raw_in)
        except Exception:
            pass

    # 优先查找 .port 文件的几个可能路径
    plugin_root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    candidates = [
        os.path.join(plugin_root, "sidecars", "pet-widget", ".port"),
        os.path.join(plugin_root, ".port"),
        os.path.normpath(os.path.join(os.path.expanduser("~"), ".gemini", "config", "plugins", "antigravity-catgirl-pet", "sidecars", "pet-widget", ".port")),
        os.path.normpath(os.path.join(os.path.expanduser("~"), ".gemini", "config", "plugins", "antigravity-catgirl-pet", ".port"))
    ]

    ports = [18980]
    for p_file in candidates:
        if os.path.exists(p_file):
            try:
                with open(p_file, "r", encoding="utf-8") as f:
                    p = int(f.read().strip())
                    if p not in ports:
                        ports.insert(0, p)
            except Exception:
                pass

    payload = {"state": args.state}
    if args.detail:
        payload["detail"] = args.detail
    if args.tokens > 0:
        payload["tokens"] = args.tokens
    if hook_ctx.get("conversationId"):
        payload["conversationId"] = hook_ctx["conversationId"]
    if hook_ctx.get("lastUserInput"):
        payload["lastUserInput"] = hook_ctx["lastUserInput"]
    if hook_ctx.get("terminationReason"):
        payload["terminationReason"] = hook_ctx["terminationReason"]

    data_bytes = json.dumps(payload).encode("utf-8")

    for port in ports:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/event",
            data=data_bytes,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=0.4) as response:
                break
        except Exception:
            continue

if __name__ == "__main__":
    main()
