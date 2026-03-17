#!/usr/bin/env python3
"""
Jarvis iOS Bridge v5 — OpenClaw Gateway chatCompletions
iOS → WebSocket :8766 → Gateway /v1/chat/completions → Response → iOS

No external API keys needed. All routing via OpenClaw gateway.
Usage: python scripts/jarvis_ios_bridge.py [--port 8766] [--model anthropic/claude-haiku-4-5]
"""
import asyncio
import json
import os
import sys
import uuid
import time
import argparse
import datetime
import signal
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

for pkg in ["websockets"]:
    try:
        __import__(pkg)
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

import websockets

# ── Config ──────────────────────────────────────────────────
PORT = 8766
GATEWAY_URL = os.environ.get("OPENCLAW_GATEWAY_URL", "http://127.0.0.1:18789")
GATEWAY_TOKEN = os.environ.get(
    "OPENCLAW_GATEWAY_TOKEN",
    "fc8925f9d4ab7453e486b98bffa6fa79116845029f5bfb2e",
)
DEFAULT_MODEL = "anthropic/claude-haiku-4-5"

SYSTEM_PROMPT = """You are Jarvis — the AI assistant of IvanArt.
You speak through Meta Ray-Ban Smart Glasses speakers.
Keep responses SHORT and CONVERSATIONAL — max 2-3 sentences.
Precise, calm, slightly witty. Russian by default unless asked otherwise.
You can handle: weather, tasks, system control, general knowledge.
You know about the agent system (Prometheus, Helios, Engineer, Penguins)."""

MAX_HISTORY = 20

# ── State ───────────────────────────────────────────────────
clients: Dict[str, "websockets.WebSocketServerProtocol"] = {}
conversations: Dict[str, List[dict]] = {}  # session_id -> messages
stats = {"total_queries": 0, "start_time": time.time()}


def log(msg: str):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


# ── Gateway Chat Completions ────────────────────────────────
def call_gateway(messages: List[dict], model: str = DEFAULT_MODEL) -> str:
    """Call OpenClaw gateway /v1/chat/completions endpoint."""
    url = f"{GATEWAY_URL}/v1/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": 300,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GATEWAY_TOKEN}",
        },
        method="POST",
    )

    try:
        resp = urllib.request.urlopen(req, timeout=45)
        data = json.loads(resp.read().decode("utf-8"))
        choices = data.get("choices", [])
        if choices:
            return choices[0].get("message", {}).get("content", "")
        return "Нет ответа от модели."
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        log(f"❌ Gateway HTTP {e.code}: {body}")
        return f"Ошибка gateway ({e.code}). Попробуй снова."
    except Exception as e:
        log(f"❌ Gateway error: {e}")
        return "Не могу связаться с gateway. Проверь соединение."


async def ask_jarvis(session_id: str, text: str, model: str = DEFAULT_MODEL) -> str:
    """Send text through gateway and manage conversation history."""
    history = conversations.setdefault(session_id, [
        {"role": "system", "content": SYSTEM_PROMPT},
    ])
    history.append({"role": "user", "content": text})

    # Trim history (keep system + last N messages)
    if len(history) > MAX_HISTORY + 1:
        history[:] = [history[0]] + history[-(MAX_HISTORY):]

    # Run in thread to not block event loop
    loop = asyncio.get_event_loop()
    reply = await loop.run_in_executor(None, call_gateway, history, model)

    history.append({"role": "assistant", "content": reply})
    stats["total_queries"] += 1
    return reply


# ── WebSocket Handler ───────────────────────────────────────
async def handle_client(ws, path: str = "/"):
    client_addr = f"{ws.remote_address[0]}:{ws.remote_address[1]}"
    session_id = str(uuid.uuid4())[:12]
    clients[session_id] = ws
    log(f"📱 Connected: {client_addr} → session {session_id}")

    await ws.send(json.dumps({
        "type": "connected",
        "session_id": session_id,
        "message": "◈ Jarvis подключён через OpenClaw Gateway",
        "model": DEFAULT_MODEL,
    }))

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
                msg_type = msg.get("type", "")
                text = msg.get("text", "").strip()

                # Restore session from client
                if msg.get("session_id"):
                    session_id = msg["session_id"]

                if msg_type in ("voice", "text", "chat", "message") and text:
                    log(f"💬 [{session_id}] {text[:80]}")

                    # State: thinking
                    await ws.send(json.dumps({
                        "type": "state",
                        "state": "thinking",
                    }))

                    # Get response via gateway
                    model = msg.get("model", DEFAULT_MODEL)
                    reply = await ask_jarvis(session_id, text, model)
                    log(f"🤖 → {reply[:80]}")

                    # Send response
                    await ws.send(json.dumps({
                        "type": "response",
                        "text": reply,
                        "state": "speaking",
                        "session_id": session_id,
                    }))

                    # State: idle (after brief pause)
                    await asyncio.sleep(0.3)
                    await ws.send(json.dumps({
                        "type": "state",
                        "state": "idle",
                    }))

                elif msg_type == "ping":
                    await ws.send(json.dumps({
                        "type": "pong",
                        "ts": time.time(),
                        "clients": len(clients),
                        "queries": stats["total_queries"],
                    }))

                elif msg_type == "clear_history":
                    conversations.pop(session_id, None)
                    await ws.send(json.dumps({
                        "type": "history_cleared",
                    }))
                    log(f"🗑 [{session_id}] History cleared")

                elif msg_type == "get_status":
                    uptime = int(time.time() - stats["start_time"])
                    await ws.send(json.dumps({
                        "type": "status",
                        "uptime_sec": uptime,
                        "clients": len(clients),
                        "total_queries": stats["total_queries"],
                        "model": DEFAULT_MODEL,
                        "gateway": GATEWAY_URL,
                    }))

                else:
                    await ws.send(json.dumps({
                        "type": "error",
                        "message": f"Unknown type: {msg_type}",
                    }))

            except json.JSONDecodeError:
                await ws.send(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON",
                }))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.pop(session_id, None)
        log(f"📱 Disconnected: {session_id} (remaining: {len(clients)})")


# ── Health endpoint ─────────────────────────────────────────
async def health_handler(path, request_headers):
    """HTTP /health on the same port."""
    if path == "/health":
        return (
            200,
            [("Content-Type", "application/json")],
            json.dumps({
                "status": "ok",
                "version": "5.0",
                "clients": len(clients),
                "queries": stats["total_queries"],
                "model": DEFAULT_MODEL,
                "gateway": GATEWAY_URL,
                "uptime": int(time.time() - stats["start_time"]),
            }).encode(),
        )
    return None


# ── Main ────────────────────────────────────────────────────
async def main(port: int, model: str):
    global DEFAULT_MODEL
    DEFAULT_MODEL = model

    print(f"""
╔═══════════════════════════════════════════════╗
║  Jarvis iOS Bridge v5 — OpenClaw Gateway      ║
║  Port: {port:<5}  Model: {model:<24} ║
║  Gateway: {GATEWAY_URL:<35} ║
╚═══════════════════════════════════════════════╝
""")

    # Verify gateway is reachable
    log("Checking gateway connection...")
    try:
        test_reply = call_gateway(
            [{"role": "user", "content": "respond with OK"}],
            model,
        )
        log(f"✅ Gateway OK — test reply: {test_reply[:50]}")
    except Exception as e:
        log(f"⚠️  Gateway check failed: {e}")
        log("   Bridge will start anyway — gateway may become available later")

    server = await websockets.serve(
        handle_client,
        "0.0.0.0",
        port,
        ping_interval=30,
        ping_timeout=10,
        process_request=health_handler,
    )
    log(f"✅ WebSocket server: ws://0.0.0.0:{port}")
    log(f"   Health: http://0.0.0.0:{port}/health")

    stop = asyncio.Event()

    def handler(sig, frame):
        log("Shutting down...")
        stop.set()

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)

    await stop.wait()
    server.close()
    await server.wait_closed()
    log("Goodbye.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Jarvis iOS Bridge v5")
    parser.add_argument("--port", type=int, default=PORT, help="WebSocket port")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="LLM model for gateway")
    args = parser.parse_args()

    try:
        asyncio.run(main(args.port, args.model))
    except KeyboardInterrupt:
        print("\nStopped.")
