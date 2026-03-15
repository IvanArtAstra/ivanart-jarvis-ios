"""
Agent Bridge — WebSocket мост между iOS приложением и агент-системой workspace
Запуск: python backend/agent_bridge.py
Порт: 8766 (рядом с TTS сервером на 8765)
"""

import asyncio
import json
import os
import glob
from datetime import datetime, timezone
from pathlib import Path
from typing import Set

import websockets
from websockets import WebSocketServerProtocol

# ─── Пути к workspace ───────────────────────────────────────────
WORKSPACE = Path(r"C:\Users\ivana\.openclaw\workspace")
QUEUE_DIR = WORKSPACE / "shared" / "queue"
RESULTS_DIR = WORKSPACE / "shared" / "results"
INBOX_DIR = WORKSPACE / "shared" / "inbox"
MEMORY_DIR = WORKSPACE / "memory"
ORCHESTRATOR_LOG = MEMORY_DIR / "orchestrator.log"

# Активные WebSocket соединения (iOS клиенты)
connected_clients: Set[WebSocketServerProtocol] = set()

# ─── Утилиты ────────────────────────────────────────────────────

def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")

def read_json(path: Path) -> list | dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_json(path: Path, data) -> bool:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False

def send_to_agent_inbox(agent: str, subject: str, task: str, priority: str = "high") -> bool:
    """Записать задачу в inbox агента"""
    inbox_path = INBOX_DIR / f"to-{agent}.md"
    entry = (
        f"\n## [{datetime.now().strftime('%Y-%m-%d %H:%M')}] "
        f"from:ios-app priority:{priority}\n"
        f"**Subject:** {subject}\n"
        f"**Task:** {task}\n\n"
    )
    try:
        with open(inbox_path, "a", encoding="utf-8") as f:
            f.write(entry)
        return True
    except Exception:
        return False


# ─── Команды ────────────────────────────────────────────────────

async def handle_command(ws: WebSocketServerProtocol, data: dict) -> dict:
    """Обработать команду от iOS приложения"""
    cmd = data.get("command", "")
    payload = data.get("payload", {})

    # 1. Статус системы
    if cmd == "system_status":
        pending = list(glob.glob(str(QUEUE_DIR / "pending" / "*.json")))
        in_progress = list(glob.glob(str(QUEUE_DIR / "in_progress" / "*.json")))
        done = list(glob.glob(str(QUEUE_DIR / "done" / "*.json")))

        # Последние строки оркестратора
        orch_last = ""
        if ORCHESTRATOR_LOG.exists():
            with open(ORCHESTRATOR_LOG, encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
                orch_last = "".join(lines[-3:]).strip()

        return {
            "type": "system_status",
            "data": {
                "pending_tasks": len(pending),
                "in_progress_tasks": len(in_progress),
                "done_tasks": len(done),
                "orchestrator_last": orch_last,
                "timestamp": utc_now(),
            }
        }

    # 2. Список активных задач
    elif cmd == "get_tasks":
        tasks = []
        for f in glob.glob(str(QUEUE_DIR / "pending" / "*.json")):
            t = read_json(Path(f))
            if t:
                tasks.append({
                    "id": t.get("id", ""),
                    "agent": t.get("agent", ""),
                    "title": t.get("title", t.get("task", ""))[:80],
                    "priority": t.get("priority", "normal"),
                    "created_at": t.get("created_at", ""),
                })
        return {"type": "tasks_list", "data": tasks}

    # 3. Отправить задачу агенту
    elif cmd == "dispatch_task":
        agent = payload.get("agent", "")
        task = payload.get("task", "")
        subject = payload.get("subject", "Задача от iOS")

        if not agent or not task:
            return {"type": "error", "message": "Нужно указать агента и задачу"}

        # Создать задачу в очереди
        task_id = f"ios_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        task_data = {
            "id": task_id,
            "agent": agent,
            "title": subject,
            "task": task,
            "priority": payload.get("priority", "normal"),
            "created_at": utc_now(),
            "source": "ios_app",
        }

        task_path = QUEUE_DIR / "pending" / f"{task_id}_{agent}.json"
        os.makedirs(task_path.parent, exist_ok=True)
        write_json(task_path, task_data)

        # Также в inbox
        send_to_agent_inbox(agent, subject, task)

        return {
            "type": "task_dispatched",
            "data": {"task_id": task_id, "agent": agent, "message": f"Задача отправлена {agent}"}
        }

    # 4. Добавить пост в очередь Гелиоса
    elif cmd == "add_post":
        posts_path = QUEUE_DIR / "helios_approved_posts.json"
        posts = read_json(posts_path) or []

        new_post = {
            "id": f"ios_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "title": payload.get("title", ""),
            "caption": payload.get("caption", ""),
            "status": "approved",
            "channel": "-1002328804262",
            "scheduled_for": payload.get("scheduled_for", ""),
            "created_via": "ios_voice",
        }
        posts.append(new_post)
        write_json(posts_path, posts)

        return {
            "type": "post_added",
            "data": {"id": new_post["id"], "title": new_post["title"]}
        }

    # 5. Последние результаты агентов
    elif cmd == "get_results":
        limit = payload.get("limit", 5)
        results = []
        files = sorted(
            glob.glob(str(RESULTS_DIR / "*.md")),
            key=os.path.getmtime,
            reverse=True
        )[:limit]

        for f in files:
            try:
                with open(f, encoding="utf-8", errors="replace") as fh:
                    content = fh.read()[:500]
                results.append({
                    "file": Path(f).name,
                    "preview": content,
                    "modified": datetime.fromtimestamp(
                        os.path.getmtime(f)
                    ).strftime("%H:%M"),
                })
            except Exception:
                pass

        return {"type": "results_list", "data": results}

    # 6. Прочитать память дня
    elif cmd == "get_today_memory":
        mem_path = MEMORY_DIR / f"{today()}.md"
        content = ""
        if mem_path.exists():
            with open(mem_path, encoding="utf-8", errors="replace") as f:
                content = f.read()
        return {"type": "today_memory", "data": {"content": content, "date": today()}}

    # 7. Ping
    elif cmd == "ping":
        return {"type": "pong", "timestamp": utc_now()}

    else:
        return {"type": "error", "message": f"Неизвестная команда: {cmd}"}


# ─── WebSocket сервер ────────────────────────────────────────────

async def handle_client(ws: WebSocketServerProtocol):
    connected_clients.add(ws)
    client_ip = ws.remote_address[0] if ws.remote_address else "unknown"
    print(f"[Bridge] iOS подключился: {client_ip} | Всего: {len(connected_clients)}")

    # Приветствие
    await ws.send(json.dumps({
        "type": "connected",
        "message": "Agent Bridge готов. IvanArt × Jarvis ⚡",
        "timestamp": utc_now(),
    }))

    try:
        async for message in ws:
            try:
                data = json.loads(message)
                print(f"[Bridge] Команда: {data.get('command')} от {client_ip}")
                response = await handle_command(ws, data)
                await ws.send(json.dumps(response, ensure_ascii=False))
            except json.JSONDecodeError:
                await ws.send(json.dumps({"type": "error", "message": "Невалидный JSON"}))
            except Exception as e:
                print(f"[Bridge] Ошибка обработки: {e}")
                await ws.send(json.dumps({"type": "error", "message": str(e)}))

    except websockets.exceptions.ConnectionClosed:
        print(f"[Bridge] iOS отключился: {client_ip}")
    finally:
        connected_clients.discard(ws)


async def push_notifications():
    """
    Пушить уведомления всем подключённым iOS клиентам.
    Следит за новыми результатами агентов и рассылает.
    """
    seen_results: Set[str] = set()
    last_orch_line = 0

    while True:
        await asyncio.sleep(10)  # проверка каждые 10 сек
        if not connected_clients:
            continue

        # Новые результаты агентов
        result_files = glob.glob(str(RESULTS_DIR / "*.md"))
        for f in result_files:
            if f not in seen_results:
                seen_results.add(f)
                try:
                    with open(f, encoding="utf-8", errors="replace") as fh:
                        content = fh.read()[:200]

                    notification = json.dumps({
                        "type": "agent_result",
                        "data": {
                            "file": Path(f).name,
                            "preview": content,
                            "timestamp": utc_now(),
                        }
                    }, ensure_ascii=False)

                    # Разослать всем клиентам
                    for client in list(connected_clients):
                        try:
                            await client.send(notification)
                        except Exception:
                            connected_clients.discard(client)
                except Exception:
                    pass


async def main():
    print("=" * 50)
    print("  IvanArt × Jarvis — Agent Bridge")
    print("  WebSocket: ws://0.0.0.0:8766")
    print("=" * 50)

    server = await websockets.serve(handle_client, "0.0.0.0", 8766)
    push_task = asyncio.create_task(push_notifications())

    print("[Bridge] ✅ Запущен и ждёт iOS подключений...")

    await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
