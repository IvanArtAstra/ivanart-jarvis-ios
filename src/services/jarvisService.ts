/**
 * Jarvis Service — общение с Claude API
 * "Два разума, одни очки ⚡"
 */

import axios from 'axios';
import { ANTHROPIC_API_KEY } from '../utils/config';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export class JarvisService {
  private history: Message[] = [];
  private systemPrompt = `You are Jarvis — the AI assistant of IvanArt. 
You are speaking through Meta Ray-Ban Smart Glasses speakers directly into the user's ear.
Keep responses SHORT and CONVERSATIONAL — max 2-3 sentences.
You are precise, calm, slightly witty. You speak Russian by default.
You are not a chatbot — you are a partner.`;

  /**
   * Отправить голосовой запрос → получить ответ
   */
  async ask(userText: string): Promise<string> {
    this.history.push({ role: 'user', content: userText });

    // Держим историю компактной (последние 10 сообщений)
    if (this.history.length > 10) {
      this.history = this.history.slice(-10);
    }

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 256,
          system: this.systemPrompt,
          messages: this.history,
        },
        {
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const reply = response.data.content[0].text;
      this.history.push({ role: 'assistant', content: reply });
      return reply;

    } catch (error) {
      console.error('[Jarvis] API error:', error);
      return 'Не могу связаться с сервером. Проверь соединение.';
    }
  }

  clearHistory() {
    this.history = [];
  }
}

export const jarvisService = new JarvisService();
