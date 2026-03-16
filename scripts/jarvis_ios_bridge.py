#!/usr/bin/env python3
"""
Jarvis iOS Bridge v3 — Dedicated Agent Architecture
iOS messages → file queue → OpenClaw isolated session → response → iOS

Usage: python scripts/jarvis_ios_bridge.py [--port 8766]
"""
import asyncio, json, os, sys, uuid, time, subprocess, re, argparse
from pathlib import Path
from datetime import datetime

for pkg in ["websockets", "openai"]:
    try: __import__(pkg.replace("-","_"))
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

import websockets
from openai import AsyncOpenAI

# ── Config ─────────────────────────────────────────────────────────
PORT       = 8766
WORKSPACE  = Path(r"C:\Users\ivana\.openclaw\workspace")
IOS_BRIDGE = WORKSPACE / "shared" / "ios_bridge"
SESSIONS   = IOS_BRIDGE / "sessions"
REQUESTS   = IOS_BRIDGE / "requests"
RESPONSES  = IOS_BRIDGE / "responses"

SYSTEM_PROMPT = """Ты Jarvis — персональный ИИ-ассистент Ивана Артемьева (Sir Ivan).
Работаешь через Ray-Ban Meta Smart Glasses и iOS приложение IvanArt × Jarvis.
Характер: спокойный, точный, с лёгкой иронией — как Jarvis из Iron Man.
Отвечай кратко (2-4 предложения), по делу. Язык: русский, если не попросят иначе.
Ты помнишь предыдущие сообщения в этом диалоге и используешь их как контекст."""

def notify_telegram(text: str):
    try:
        cfg = (Path.home() / ".openclaw" / "openclaw.json").read_text(encoding="utf-8")
        token = re.search(r'"token"\s*:\s*"(\d+:[A-Za-z0-9_\-]+)"', cfg)
        if not token: return
        import urllib.request
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token.group(1)}/sendMessage",
            data=json.dumps({"chat_id": "2146714203", "text": text, "parse_mode": "HTML"}).encode(),
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print(f"[TG] {e}")

def get_client():
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        try:
            cfg = (Path.home() / ".openclaw" / "openclaw.json").read_text(encoding="utf-8")
            m = re.search(r'sk-proj-[A-Za-z0-9_\-]+', cfg)
            key = m.group(0) if m else ""
        except: pass
    return AsyncOpenAI(api_key=key) if key else None

# ── Session Memory ─────────────────────────────────────────────────
def load_session(session_id: str) -> dict:
    """Load persistent session (history + metadata)."""
    path = SESSIONS / f"{session_id}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"id": session_id, "created": datetime.now().isoformat(), "history": [], "messages": 0}

def save_session(session_id: str, data: dict):
    """Persist session state."""
    path = SESSIONS / f"{session_id}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def append_conversation_log(session_id: str, role: str, text: str):
    """Append to human-readable conversation log."""
    log_path = IOS_BRIDGE / f"conversation_{session_id}.md"
    ts = datetime.now().strftime("%H:%M:%S")
    prefix = "🗣 **Ты**" if role == "user" else "◈ **Jarvis**"
    entry = f"\n**{ts}** {prefix}: {text}\n"
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(entry)

# ── AI Processing ──────────────────────────────────────────────────
async def ask_ai(client: AsyncOpenAI, text: str, history: list) -> str:
    if not client:
        return "Ошибка: API ключ не найден. Проверь OPENAI_API_KEY."
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs += history[-20:]
    msgs.append({"role": "user", "content": text})
    try:
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=msgs,
            max_tokens=400,
            temperature=0.7,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return f"Ошибка API: {str(e)[:120]}"

# ── Request Queue ──────────────────────────────────────────────────
pending_responses: dict[str, asyncio.Future] = {}

async def process_request(client: AsyncOpenAI, req_id: str, session_id: str, text: str):
    """Process iOS message and resolve the future."""
    session = load_session(session_id)
    history = session["history"]

    # Log incoming
    append_conversation_log(session_id, "user", text)
    print(f"[iOS/{session_id[:8]}] 🗣 {text}")

    # Call AI
    reply = await ask_ai(client, text, history)

    # Update session
    history.append({"role": "user", "content": text})
    history.append({"role": "assistant", "content": reply})
    if len(history) > 40: history = history[-40:]
    session["history"] = history
    session["messages"] += 1
    save_session(session_id, session)

    # Log response
    append_conversation_log(session_id, "assistant", reply)
    print(f"[Jarvis/{session_id[:8]}] {reply[:80]}")

    # Write response file (for OpenClaw cron pickup)
    resp_file = RESPONSES / f"{req_id}.json"
    resp_file.write_text(json.dumps({
        "req_id": req_id, "session_id": session_id,
        "text": reply, "timestamp": datetime.now().isoformat()
    }, ensure_ascii=False), encoding="utf-8")

    # Resolve pending future
    if req_id in pending_responses:
        pending_responses[req_id].set_result(reply)

# ── WebSocket Handler ──────────────────────────────────────────────
async def handle(ws):
    client = get_client()
    session_id = str(uuid.uuid4())[:12]
    print(f"[+] New iOS session: {session_id}")

    try:
        # Welcome with session info
        await ws.send(json.dumps({
            "type": "connected",
            "session_id": session_id,
            "message": f"◈ Jarvis подключён | Сессия: {session_id}"
        }))

        async for raw in ws:
            try:
                data = json.loads(raw)
                t    = data.get("type", "")
                text = data.get("text", "").strip()

                # Accept session_id from client if provided
                if data.get("session_id"):
                    session_id = data["session_id"]

                if t in ("voice", "text", "chat") and text:
                    req_id = str(uuid.uuid4())

                    # State: thinking
                    await ws.send(json.dumps({"type": "state", "state": "thinking"}))

                    # Create future for this request
                    loop = asyncio.get_event_loop()
                    fut = loop.create_future()
                    pending_responses[req_id] = fut

                    # Process async
                    asyncio.create_task(process_request(client, req_id, session_id, text))

                    # Wait for response (max 30s)
                    try:
                        reply = await asyncio.wait_for(fut, timeout=30)
                        await ws.send(json.dumps({
                            "type": "response",
                            "text": reply,
                            "state": "idle",
                            "session_id": session_id
                        }))
                    except asyncio.TimeoutError:
                        await ws.send(json.dumps({
                            "type": "error",
                            "text": "Timeout — попробуй снова",
                            "state": "idle"
                        }))
                    finally:
                        pending_responses.pop(req_id, None)

                elif t == "ping":
                    await ws.send(json.dumps({"type": "pong"}))

                elif t == "get_session":
                    session = load_session(session_id)
                    await ws.send(json.dumps({
                        "type": "session_info",
                        "session_id": session_id,
                        "messages": session["messages"],
                        "created": session["created"]
                    }))

            except json.JSONDecodeError:
                await ws.send(json.dumps({"type": "error", "message": "Bad JSON"}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"[-] Session closed: {session_id}")

# ── Main ───────────────────────────────────────────────────────────
async def main(port: int):
    client = get_client()
    status = "GPT-4o-mini ✅" if client else "⚠️ No API key!"

    print(f"""
╔══════════════════════════════════════════╗
║   Jarvis iOS Bridge v3 — Agent Mode      ║
║   Port: {port}  |  AI: {status:<20}║
╚══════════════════════════════════════════╝
📁 Sessions: {SESSIONS}
📁 Logs:     {IOS_BRIDGE}
""")

    notify_telegram(
        f"🤖 <b>Jarvis iOS Bridge v3 запущен</b>\n\n"
        f"🎯 Режим: Dedicated Agent Sessions\n"
        f"📡 <code>ws://192.168.0.39:{port}</code>\n"
        f"📁 Логи: shared/ios_bridge/\n\n"
        f"Каждый iOS клиент — отдельная сессия с памятью."
    )

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
