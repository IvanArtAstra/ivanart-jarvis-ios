/**
 * CommandParser — парсит голосовые команды в действия агент-системы
 *
 * Примеры:
 * "Джарвис, что у меня на сегодня?" → system_status
 * "Джарвис, запусти Гелиоса сделать пост" → dispatch helios
 * "Джарвис, сколько задач в очереди?" → get_tasks
 * "Джарвис, добавь пост про Bitcoin" → add_post
 * "Джарвис, что сделал Прометей?" → get_results
 */

import { agentBridgeService } from './agentBridgeService';
import { appControlService } from './appControlService';

export interface ParsedCommand {
  type: 'agent_command' | 'normal_chat';
  action?: string;
  agent?: string;
  content?: string;
  response?: string; // немедленный ответ без AI
}

// Карта агентов (голос → id)
const AGENT_MAP: Record<string, string> = {
  'гелиос': 'helios',
  'helios': 'helios',
  'прометей': 'prometheus',
  'prometheus': 'prometheus',
  'инженер': 'engineer',
  'engineer': 'engineer',
  'скиппер': 'skipper',
  'skipper': 'skipper',
  'ковальски': 'kowalski',
  'kowalski': 'kowalski',
  'рико': 'rico',
  'rico': 'rico',
};

export class CommandParserService {

  /**
   * Попробовать распарсить как команду агент-системы
   * Возвращает null если это обычный вопрос для Claude
   */
  async parse(text: string): Promise<ParsedCommand | null> {
    const lower = text.toLowerCase().trim();

    // ─── Статус системы ───────────────────────────────────────────
    if (
      lower.match(/что.*сегодня|план.*дня|что.*делаем|статус системы|как дела|что.*происходит/)
    ) {
      try {
        const status = await agentBridgeService.getSystemStatus();
        const response = this.formatStatus(status);
        return { type: 'agent_command', action: 'status', response };
      } catch {
        return { type: 'agent_command', action: 'status', response: 'Не могу получить статус — Bridge не подключён.' };
      }
    }

    // ─── Задачи в очереди ─────────────────────────────────────────
    if (lower.match(/задач|очередь|pending|в работе|что.*делают/)) {
      try {
        const tasks = await agentBridgeService.getTasks();
        const response = tasks.length === 0
          ? 'Очередь пуста. Все агенты свободны.'
          : `В очереди ${tasks.length} задач: ${tasks.slice(0, 3).map(t => `${t.agent}: ${t.title}`).join(', ')}`;
        return { type: 'agent_command', action: 'tasks', response };
      } catch {
        return null;
      }
    }

    // ─── Результаты агентов ───────────────────────────────────────
    if (lower.match(/результат|что.*сделал|что.*готово|завершил|выполнил/)) {
      try {
        const results = await agentBridgeService.getRecentResults();
        if (results.length === 0) return { type: 'agent_command', response: 'Новых результатов нет.' };
        const latest = results[0];
        const response = `Последний результат: ${latest.file.replace('.md', '')} в ${latest.modified}. ${latest.preview.slice(0, 100)}`;
        return { type: 'agent_command', action: 'results', response };
      } catch {
        return null;
      }
    }

    // ─── Запустить агента ─────────────────────────────────────────
    const agentMatch = this.detectAgent(lower);
    if (agentMatch && lower.match(/запусти|отправь|скажи|попроси|дай задачу/)) {
      const taskContent = this.extractTaskContent(text, agentMatch.original);
      if (taskContent) {
        try {
          const result = await agentBridgeService.dispatchTask(
            agentMatch.id,
            taskContent,
            `Голосовая команда: ${taskContent.slice(0, 50)}`
          );
          return {
            type: 'agent_command',
            action: 'dispatch',
            agent: agentMatch.id,
            response: `Задача отправлена ${agentMatch.name}. ${result}`,
          };
        } catch {
          return { type: 'agent_command', response: `Не удалось отправить задачу ${agentMatch.name}.` };
        }
      }
    }

    // ─── Добавить пост ────────────────────────────────────────────
    if (lower.match(/добавь пост|создай пост|запланируй пост|пост.*про|опубликуй/)) {
      const topic = lower.replace(/добавь пост|создай пост|запланируй пост|про|об|о|опубликуй/, '').trim();
      if (topic) {
        // Простой шаблон поста
        const caption = `🔥 ${topic.charAt(0).toUpperCase() + topic.slice(1)}\n\n**Ivan:** Интересная тема...\n**Jarvis:** Разберём детально.\n\n**IvanArt × Jarvis** | Два разума, один канал ⚡`;
        try {
          const id = await agentBridgeService.addPost(topic, caption);
          return {
            type: 'agent_command',
            action: 'add_post',
            response: `Пост про "${topic}" добавлен в очередь. Выйдет сегодня в 20:00.`,
          };
        } catch {
          return { type: 'agent_command', response: 'Не удалось добавить пост.' };
        }
      }
    }

    // ─── Память дня ───────────────────────────────────────────────
    if (lower.match(/что.*делали|что было|итоги|память дня|вспомни/)) {
      try {
        const memory = await agentBridgeService.getTodayMemory();
        if (!memory) return { type: 'agent_command', response: 'Записей на сегодня нет.' };
        // Берём последние 200 символов
        const summary = memory.slice(-300).replace(/#+/g, '').trim();
        return { type: 'agent_command', action: 'memory', response: `Сегодня: ${summary}` };
      } catch {
        return null;
      }
    }

    // ─── Управление iOS приложениями ──────────────────────────────────
    const appResult = await appControlService.handleCommand(lower);
    if (appResult) {
      return {
        type: 'agent_command',
        action: 'open_app',
        response: appResult,
      };
    }

    // Не команда — передать в Claude
    return null;
  }

  private detectAgent(text: string): { id: string; name: string; original: string } | null {
    for (const [key, id] of Object.entries(AGENT_MAP)) {
      if (text.includes(key)) {
        return { id, name: key, original: key };
      }
    }
    return null;
  }

  private extractTaskContent(text: string, agentName: string): string {
    // Убрать префиксы команды и имя агента
    return text
      .replace(/джарвис[,.]?\s*/gi, '')
      .replace(/запусти|отправь|скажи|попроси|дай задачу/gi, '')
      .replace(new RegExp(agentName, 'gi'), '')
      .trim();
  }

  private formatStatus(status: any): string {
    const parts = [];
    if (status.pending_tasks > 0) parts.push(`${status.pending_tasks} задач в очереди`);
    if (status.in_progress_tasks > 0) parts.push(`${status.in_progress_tasks} в работе`);
    if (status.done_tasks > 0) parts.push(`${status.done_tasks} завершено`);

    if (parts.length === 0) return 'Система в штатном режиме. Очередь пуста, все агенты свободны.';
    return `Статус: ${parts.join(', ')}.`;
  }
}

export const commandParserService = new CommandParserService();
