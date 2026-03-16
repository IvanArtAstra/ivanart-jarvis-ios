#!/usr/bin/env python3
"""
Jarvis iOS Bridge v4 — Direct OpenClaw Routing
iOS → WebSocket Bridge → File Queue → Jarvis (OpenClaw) → Response → iOS

No external API keys needed. All processing by Jarvis via OpenClaw gateway.
Usage: python scripts/jarvis_ios_bridge.py [--port 8766]
"""
import asyncio, json, os, sys, uuid, time, subprocess, re, argparse
from pathlib import Path
from datetime import datetime

for pkg in ["websockets"]:
    try: __import__(pkg)
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

import websockets

PORT       = 8766
WORKSPACE  = Path(r"C:\Users\ivana\.openclaw\workspace")
IOS_BRIDGE = WORKSPACE / "shared" / "ios_bridge"
REQUESTS   = IOS_BRIDGE / "requests"
RESPONSES  = IOS_BRIDGE / "responses"
SESSIONS   = IOS_BRIDGE / "sessions"

for d in [REQUESTS, RESPONSES, SESSIONS]:
    d.mkdir(parents=True, exist_ok=True)

# ── Session ────────────────────────────────────────────────────────
def load_session(sid):
    p = SESSIONS / f"{sid}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"id": sid, "created": datetime.now().isoformat(), "messages": 0}

def save_session(sid, data):
    (SESSIONS / f"{sid}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def log_conversation(sid, role, text):
    p = IOS_BRIDGE / f"conversation_{sid}.md"
    ts = datetime.now().strftime("%H:%M:%S")
    icon = "🗣" if role == "user" else "◈"
    with open(p, "a", encoding="utf-8") as f:
        f.write(f"\n**{ts}** {icon} {text}\n")

# ── WebSocket handler ──────────────────────────────────────────────
async def handle(ws):
    sid = str(uuid.uuid4())[:12]
    print(f"[+] iOS session: {sid}")
    try:
        await ws.send(json.dumps({
            "type": "connected",
            "session_id": sid,
            "message": f"◈ Jarvis подключён | Сессия: {sid}"
        }))

        async for raw in ws:
            try:
                data = json.loads(raw)
                t    = data.get("type", "")
                text = data.get("text", "").strip()
                if data.get("session_id"):
                    sid = data["session_id"]

                if t in ("voice", "text", "chat") and text:
                    req_id = str(uuid.uuid4())
                    await ws.send(json.dumps({"type": "state", "state": "thinking"}))

                    # Log incoming
                    log_conversation(sid, "user", text)
                    session = load_session(sid)

                    # Write request to queue — Jarvis cron picks up
                    req = {
                        "req_id": req_id,
                        "session_id": sid,
                        "text": text,
                        "timestamp": datetime.now().isoformat(),
                        "status": "pending"
                    }
                    (REQUESTS / f"{req_id}.json").write_text(
                        json.dumps(req, ensure_ascii=False), encoding="utf-8")
                    print(f"[Queue] → {req_id[:8]} | {text[:60]}")

                    # Wait for Jarvis response (poll response file, max 30s)
                    resp_file = RESPONSES / f"{req_id}.json"
                    reply = None
                    for _ in range(60):  # 60 × 0.5s = 30s
                        await asyncio.sleep(0.5)
                        if resp_file.exists():
                            r = json.loads(resp_file.read_text(encoding="utf-8"))
                            reply = r.get("text", "")
                            resp_file.unlink(missing_ok=True)
                            (REQUESTS / f"{req_id}.json").unlink(missing_ok=True)
                            break

                    if reply:
                        log_conversation(sid, "assistant", reply)
                        session["messages"] = session.get("messages", 0) + 1
                        save_session(sid, session)
                        await ws.send(json.dumps({
                            "type": "response",
                            "text": reply,
                            "state": "idle",
                            "session_id": sid
                        }))
                        print(f"[Jarvis] {reply[:80]}")
                    else:
                        await ws.send(json.dumps({
                            "type": "error",
                            "text": "Нет ответа — Jarvis занят, попробуй снова",
                            "state": "idle"
                        }))

                elif t == "ping":
                    await ws.send(json.dumps({"type": "pong"}))

            except json.JSONDecodeError:
                await ws.send(json.dumps({"type": "error", "message": "Bad JSON"}))
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"[-] Session: {sid}")

# ── Main ───────────────────────────────────────────────────────────
async def main(port):
    print(f"""
╔═══════════════════════════════════════════╗
║  Jarvis iOS Bridge v4 — OpenClaw Direct   ║
║  Port: {port}  |  Queue: shared/ios_bridge/  ║
╚═══════════════════════════════════════════╝
Routing: iOS → File Queue → Jarvis (OpenClaw) → iOS
""")
    async with websockets.serve(handle, "0.0.0.0", port):
        print(f"[WS] ws://0.0.0.0:{port} ✅\n")
        await asyncio.Future()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=PORT)
    args = p.parse_args()
    try:
        asyncio.run(main(args.port))
    except KeyboardInterrupt:
        print("\nStopped.")
