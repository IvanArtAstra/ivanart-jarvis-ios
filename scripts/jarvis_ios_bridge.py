#!/usr/bin/env python3
"""
Jarvis iOS Bridge — WebSocket server :8766
Connects iPhone app to Claude AI backend.
Auto-creates bore.pub tunnel and notifies Telegram.

Usage:
  python scripts/jarvis_ios_bridge.py
  python scripts/jarvis_ios_bridge.py --port 8766
"""

import asyncio
import json
import os
import subprocess
import sys
import time
import threading
import argparse
import re
import urllib.request
import urllib.parse
from pathlib import Path

try:
    import websockets
except ImportError:
    print("Installing websockets...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets"])
    import websockets

try:
    import anthropic
except ImportError:
    print("Installing anthropic...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "anthropic"])
    import anthropic

# ── Config ──────────────────────────────────────────────────────────
WORKSPACE = Path(__file__).parent.parent
DEFAULT_PORT = 8766
SYSTEM_PROMPT = """Ты Jarvis — ИИ-ассистент Ивана Артемьева (Sir Ivan).
Работаешь через Ray-Ban Meta Smart Glasses и iOS приложение.
Отвечай кратко (2-4 предложения), по делу, с лёгкой иронией Jarvis из Iron Man.
Язык: русский, если не попросят иначе.
Контекст: Sir Ivan — разработчик, строит систему Jarvis для умных очков Ray-Ban Meta."""

# ── Telegram notify ──────────────────────────────────────────────────
def get_telegram_token():
    """Get bot token from openclaw.json."""
    config_path = Path.home() / ".openclaw" / "openclaw.json"
    try:
        with open(config_path, encoding="utf-8") as f:
            import re
            data = f.read()
            # Find telegram token
            match = re.search(r'"token"\s*:\s*"([^"]+)"', data)
            if match:
                return match.group(1)
    except Exception:
        pass
    return os.environ.get("TELEGRAM_BOT_TOKEN", "")

def notify_telegram(text: str, chat_id: str = "2146714203"):
    token = get_telegram_token()
    if not token:
        print("[Telegram] No token found, skipping notification")
        return
    try:
        payload = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=payload.encode(),
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=10)
        print(f"[Telegram] Notified: {text[:60]}...")
    except Exception as e:
        print(f"[Telegram] Failed: {e}")

# ── bore.pub tunnel ──────────────────────────────────────────────────
bore_url = None

def start_bore_tunnel(port: int):
    """Start bore.pub tunnel in background thread."""
    global bore_url

    def run():
        global bore_url
        try:
            proc = subprocess.Popen(
                ["bore", "local", str(port), "--to", "bore.pub"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )
            for line in proc.stdout:
                line = line.strip()
                print(f"[bore] {line}")
                match = re.search(r'bore\.pub:(\d+)', line)
                if match:
                    bore_url = f"ws://bore.pub:{match.group(1)}"
                    print(f"\n✅ TUNNEL READY: {bore_url}\n")
                    msg = (
                        f"🌐 <b>Jarvis iOS Bridge готов!</b>\n\n"
                        f"📡 Tunnel URL:\n<code>{bore_url}</code>\n\n"
                        f"Вставь в iOS → Настройки → Bridge URL"
                    )
                    notify_telegram(msg)
            proc.wait()
        except FileNotFoundError:
            print("[bore] 'bore' not found. Install: cargo install bore-cli")
            print(f"[Bridge] Running locally at: ws://localhost:{port}")
            notify_telegram(
                f"⚡ <b>Jarvis iOS Bridge запущен</b>\n\n"
                f"📡 Tailscale: <code>ws://100.70.68.84:{port}</code>\n"
                f"(bore не установлен — туннель недоступен)\n\n"
                f"Убедись что iPhone в той же сети или используй Tailscale."
            )
        except Exception as e:
            print(f"[bore] Error: {e}")

    t = threading.Thread(target=run, daemon=True)
    t.start()

# ── Claude client ────────────────────────────────────────────────────
def get_anthropic_key():
    """Get API key from env or openclaw.json."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    config_path = Path.home() / ".openclaw" / "openclaw.json"
    try:
        with open(config_path, encoding="utf-8") as f:
            data = f.read()
            match = re.search(r'sk-ant-[A-Za-z0-9\-_]+', data)
            if match:
                return match.group(0)
    except Exception:
        pass
    return ""

async def ask_claude(text: str, history: list) -> str:
    """Send message to Claude and get response."""
    api_key = get_anthropic_key()
    if not api_key:
        return "Ошибка: API ключ Anthropic не найден."

    client = anthropic.Anthropic(api_key=api_key)

    messages = history[-10:] + [{"role": "user", "content": text}]

    try:
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        return response.content[0].text
    except Exception as e:
        return f"Ошибка Claude API: {str(e)[:100]}"

# ── WebSocket handler ────────────────────────────────────────────────
connected_clients = set()

async def handle_client(websocket):
    """Handle a single iOS client connection."""
    client_addr = websocket.remote_address
    print(f"[Bridge] ✅ Client connected: {client_addr}")
    connected_clients.add(websocket)

    history = []

    try:
        await websocket.send(json.dumps({
            "type": "connected",
            "message": "Jarvis iOS Bridge подключён",
            "bore_url": bore_url
        }))

        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type", "")
                text = data.get("text", "").strip()

                if msg_type in ("voice", "text") and text:
                    print(f"[Bridge] 📨 '{text}'")

                    # State: thinking
                    await websocket.send(json.dumps({
                        "type": "state",
                        "state": "thinking"
                    }))

                    # Ask Claude
                    response = await ask_claude(text, history)

                    # Update history
                    history.append({"role": "user", "content": text})
                    history.append({"role": "assistant", "content": response})

                    # Send response
                    await websocket.send(json.dumps({
                        "type": "response",
                        "text": response,
                        "state": "idle"
                    }))

                    print(f"[Bridge] 💬 Response sent ({len(response)} chars)")

                elif msg_type == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))

            except json.JSONDecodeError:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON"
                }))

    except websockets.exceptions.ConnectionClosed:
        print(f"[Bridge] Client disconnected: {client_addr}")
    finally:
        connected_clients.discard(websocket)

# ── Main ─────────────────────────────────────────────────────────────
async def main(port: int):
    print(f"""
╔══════════════════════════════════════╗
║     Jarvis iOS Bridge v1.0           ║
║     Port: {port}                       ║
╚══════════════════════════════════════╝
""")

    # Start bore tunnel
    start_bore_tunnel(port)

    # Start WebSocket server
    async with websockets.serve(handle_client, "0.0.0.0", port):
        print(f"[Bridge] 🚀 WebSocket server running on ws://0.0.0.0:{port}")
        print(f"[Bridge] Waiting for bore tunnel URL...")
        print(f"[Bridge] Press Ctrl+C to stop\n")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Jarvis iOS WebSocket Bridge")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    try:
        asyncio.run(main(args.port))
    except KeyboardInterrupt:
        print("\n[Bridge] Stopped.")
