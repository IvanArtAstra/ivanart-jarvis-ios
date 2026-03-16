#!/usr/bin/env python3
"""
Jarvis iOS Bridge v2 — WebSocket + OpenAI GPT-4
Routes iOS app messages through local AI, no separate auth needed.

Usage: python scripts/jarvis_ios_bridge.py [--port 8766]
"""
import asyncio, json, os, sys, subprocess, re, threading, argparse
from pathlib import Path

# Auto-install deps
for pkg in ["websockets", "openai"]:
    try: __import__(pkg.replace("-","_"))
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

import websockets
from openai import AsyncOpenAI

PORT      = 8766
WORKSPACE = Path(__file__).parent.parent

SYSTEM_PROMPT = """Ты Jarvis — персональный ИИ-ассистент Ивана Артемьева (Sir Ivan).
Работаешь через Ray-Ban Meta Smart Glasses и iOS приложение IvanArt × Jarvis.
Характер: спокойный, точный, с лёгкой иронией — как Jarvis из Iron Man.
Отвечай кратко (2-4 предложения), по делу. Язык: русский, если не попросят иначе.
Sir Ivan — разработчик, строит систему Jarvis для умных очков."""

# ── Telegram notify ────────────────────────────────────────────────
def notify_telegram(text: str):
    try:
        cfg = (Path.home() / ".openclaw" / "openclaw.json").read_text(encoding="utf-8")
        token = re.search(r'"token"\s*:\s*"([^"]+Bot[^"]+)"', cfg)
        if not token: return
        import urllib.request
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token.group(1)}/sendMessage",
            data=json.dumps({"chat_id": "2146714203", "text": text}).encode(),
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print(f"[TG] {e}")

# ── OpenAI client ──────────────────────────────────────────────────
def get_client():
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        cfg = (Path.home() / ".openclaw" / "openclaw.json").read_text(encoding="utf-8")
        m = re.search(r'sk-proj-[A-Za-z0-9_\-]+', cfg)
        key = m.group(0) if m else ""
    return AsyncOpenAI(api_key=key) if key else None

async def ask_ai(client, text: str, history: list) -> str:
    if not client:
        return "Ошибка: API ключ не найден."
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs += history[-16:]
    msgs.append({"role": "user", "content": text})
    try:
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=msgs,
            max_tokens=400,
            temperature=0.7,
        )
        return resp.choices[0].message.content
    except Exception as e:
        return f"Ошибка: {str(e)[:120]}"

# ── WebSocket handler ──────────────────────────────────────────────
async def handle(ws):
    addr = ws.remote_address
    print(f"[+] {addr}")
    client = get_client()
    history = []
    try:
        await ws.send(json.dumps({"type": "connected", "message": "Jarvis Bridge v2 подключён ✅"}))
        async for raw in ws:
            try:
                data = json.loads(raw)
                t, text = data.get("type",""), data.get("text","").strip()
                if t in ("voice","text","chat") and text:
                    print(f"[iOS] {text}")
                    await ws.send(json.dumps({"type":"state","state":"thinking"}))
                    reply = await ask_ai(client, text, history)
                    history += [{"role":"user","content":text},
                                {"role":"assistant","content":reply}]
                    if len(history) > 20: history = history[-20:]
                    await ws.send(json.dumps({"type":"response","text":reply,"state":"idle"}))
                    print(f"[J] {reply[:80]}")
                elif t == "ping":
                    await ws.send(json.dumps({"type":"pong"}))
            except json.JSONDecodeError:
                await ws.send(json.dumps({"type":"error","message":"Bad JSON"}))
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"[-] {addr}")

# ── Main ───────────────────────────────────────────────────────────
async def main(port):
    print(f"\n╔══════════════════════════════════════╗")
    print(f"║  Jarvis iOS Bridge v2  ::{port}          ║")
    print(f"╚══════════════════════════════════════╝\n")
    client = get_client()
    if client:
        print(f"[AI] OpenAI GPT-4o-mini ✅")
    else:
        print(f"[AI] ⚠️  No API key found!")

    notify_telegram(f"🤖 <b>Jarvis iOS Bridge v2 запущен</b>\nПорт: {port}\nIP: 192.168.0.39:{port}")

    async with websockets.serve(handle, "0.0.0.0", port):
        print(f"[WS] ws://0.0.0.0:{port}  ✅\n")
        await asyncio.Future()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=PORT)
    args = p.parse_args()
    try:
        asyncio.run(main(args.port))
    except KeyboardInterrupt:
        print("\nStopped.")
