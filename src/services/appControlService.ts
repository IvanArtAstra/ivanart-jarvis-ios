/**
 * appControlService.ts
 * Управление iOS приложениями через URL Schemes
 * Jarvis может открывать приложения по голосовой команде
 */

import { Linking, Alert } from 'react-native';

// ─── Карта приложений ────────────────────────────────────────────────────────

interface AppDefinition {
  name: string;
  schemes: string[];           // URL схемы для открытия
  fallbackUrl?: string;        // ссылка в App Store если не установлено
  keywords: string[];          // слова-триггеры на русском
}

const APPS: Record<string, AppDefinition> = {
  telegram: {
    name: 'Telegram',
    schemes: ['tg://'],
    fallbackUrl: 'https://apps.apple.com/app/telegram-messenger/id686449807',
    keywords: ['телеграм', 'telegram', 'тг'],
  },
  spotify: {
    name: 'Spotify',
    schemes: ['spotify://'],
    fallbackUrl: 'https://apps.apple.com/app/spotify/id324684580',
    keywords: ['спотифай', 'spotify', 'музыку', 'музыка', 'плейлист'],
  },
  maps: {
    name: 'Maps',
    schemes: ['maps://'],
    fallbackUrl: '',
    keywords: ['карты', 'навигатор', 'маршрут', 'maps'],
  },
  youtube: {
    name: 'YouTube',
    schemes: ['youtube://'],
    fallbackUrl: 'https://apps.apple.com/app/youtube/id544007664',
    keywords: ['ютуб', 'youtube', 'видео'],
  },
  instagram: {
    name: 'Instagram',
    schemes: ['instagram://'],
    fallbackUrl: 'https://apps.apple.com/app/instagram/id389801252',
    keywords: ['инстаграм', 'instagram'],
  },
  safari: {
    name: 'Safari',
    schemes: ['https://'],
    keywords: ['сафари', 'браузер', 'safari', 'открой сайт'],
  },
  camera: {
    name: 'Камера',
    schemes: ['camera://'],
    keywords: ['камеру', 'камера', 'камерой', 'сфоткай', 'фото'],
  },
  facetime: {
    name: 'FaceTime',
    schemes: ['facetime://'],
    keywords: ['фейстайм', 'facetime', 'видеозвонок'],
  },
  phone: {
    name: 'Телефон',
    schemes: ['tel://'],
    keywords: ['позвони', 'звони', 'набери', 'вызови'],
  },
  settings: {
    name: 'Настройки',
    schemes: ['app-settings:'],
    keywords: ['настройки', 'settings', 'настройку'],
  },
  shortcuts: {
    name: 'Shortcuts',
    schemes: ['shortcuts://'],
    fallbackUrl: 'https://apps.apple.com/app/shortcuts/id915249334',
    keywords: ['shortcuts', 'шорткат', 'быстрые команды', 'автоматизация'],
  },
  clock: {
    name: 'Часы',
    schemes: ['clock-alarm://'],
    keywords: ['будильник', 'таймер', 'часы'],
  },
  notes: {
    name: 'Заметки',
    schemes: ['mobilenotes://'],
    keywords: ['заметки', 'заметку', 'notes'],
  },
};

// ─── Специальные команды ─────────────────────────────────────────────────────

interface SpecialCommand {
  keywords: string[];
  handler: (text: string) => Promise<string>;
}

const SPECIAL_COMMANDS: SpecialCommand[] = [
  {
    // "позвони Раe" / "набери +7912..."
    keywords: ['позвони', 'набери', 'звони', 'вызови'],
    handler: async (text: string) => {
      // Извлечь номер из текста
      const phoneMatch = text.match(/[\+\d][\d\s\-\(\)]{7,}/);
      if (phoneMatch) {
        const number = phoneMatch[0].replace(/[\s\-\(\)]/g, '');
        await Linking.openURL(`tel:${number}`);
        return `Звоню на ${phoneMatch[0]}`;
      }
      // Известные контакты
      if (text.includes('рае') || text.includes('рая') || text.includes('paradise')) {
        await Linking.openURL('tel:+79526590522');
        return 'Звоню Рае 💕';
      }
      await Linking.openURL('tel://');
      return 'Открываю телефон';
    },
  },
  {
    // "напиши в телеграм Рае привет"
    keywords: ['напиши', 'отправь сообщение', 'напишем'],
    handler: async (text: string) => {
      if (text.includes('рае') || text.includes('рая')) {
        await Linking.openURL('tg://resolve?domain=RFPRFP');
        return 'Открываю чат с Раей в Telegram';
      }
      await Linking.openURL('tg://');
      return 'Открываю Telegram';
    },
  },
  {
    // "проложи маршрут домой" / "навигатор до..."
    keywords: ['маршрут', 'навигатор до', 'проложи', 'как добраться'],
    handler: async (text: string) => {
      // Извлечь адрес
      const toMatch = text.match(/до\s+(.+?)(?:\s+от|\s*$)/i);
      if (toMatch) {
        const destination = encodeURIComponent(toMatch[1].trim());
        await Linking.openURL(`maps://?daddr=${destination}`);
        return `Прокладываю маршрут до ${toMatch[1].trim()}`;
      }
      await Linking.openURL('maps://');
      return 'Открываю карты';
    },
  },
  {
    // "поищи в ютубе..."
    keywords: ['поищи', 'найди видео', 'включи в ютубе'],
    handler: async (text: string) => {
      const searchMatch = text.match(/(?:поищи|найди|включи)\s+(.+?)(?:\s+в ютубе|\s+на ютубе|$)/i);
      if (searchMatch) {
        const query = encodeURIComponent(searchMatch[1].trim());
        const url = `youtube://search?q=${query}`;
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
        } else {
          await Linking.openURL(`https://youtube.com/results?search_query=${query}`);
        }
        return `Ищу "${searchMatch[1].trim()}" на YouTube`;
      }
      await Linking.openURL('youtube://');
      return 'Открываю YouTube';
    },
  },
  {
    // "запусти шорткат [название]"
    keywords: ['запусти шорткат', 'выполни шорткат', 'shortcuts'],
    handler: async (text: string) => {
      const nameMatch = text.match(/(?:шорткат|shortcut)\s+["«]?(.+?)["»]?\s*$/i);
      if (nameMatch) {
        const name = encodeURIComponent(nameMatch[1].trim());
        await Linking.openURL(`shortcuts://run-shortcut?name=${name}`);
        return `Запускаю шорткат "${nameMatch[1].trim()}"`;
      }
      await Linking.openURL('shortcuts://');
      return 'Открываю Shortcuts';
    },
  },
];

// ─── Основная логика ─────────────────────────────────────────────────────────

class AppControlService {

  /**
   * Пытается разобрать текст команды как управление приложением
   * Возвращает строку-ответ или null если команда не найдена
   */
  async handleCommand(text: string): Promise<string | null> {
    const lower = text.toLowerCase();

    // Проверить специальные команды (с параметрами)
    for (const cmd of SPECIAL_COMMANDS) {
      if (cmd.keywords.some(kw => lower.includes(kw))) {
        try {
          return await cmd.handler(lower);
        } catch (e) {
          return null;
        }
      }
    }

    // Проверить простое открытие приложения
    const openKeywords = ['открой', 'запусти', 'включи', 'открыть', 'зайди в'];
    const wantsToOpen = openKeywords.some(kw => lower.includes(kw));

    if (wantsToOpen) {
      for (const [, app] of Object.entries(APPS)) {
        if (app.keywords.some(kw => lower.includes(kw))) {
          return await this.openApp(app);
        }
      }
    }

    return null;
  }

  /** Открыть приложение по схеме */
  private async openApp(app: AppDefinition): Promise<string> {
    for (const scheme of app.schemes) {
      try {
        const canOpen = await Linking.canOpenURL(scheme);
        if (canOpen) {
          await Linking.openURL(scheme);
          return `Открываю ${app.name}`;
        }
      } catch {
        continue;
      }
    }

    // Приложение не установлено
    if (app.fallbackUrl) {
      await Linking.openURL(app.fallbackUrl);
      return `${app.name} не установлен. Открываю App Store.`;
    }
    return `${app.name} недоступен на этом устройстве`;
  }

  /** Список всех поддерживаемых приложений */
  getSupportedApps(): string[] {
    return Object.values(APPS).map(a => a.name);
  }
}

export const appControlService = new AppControlService();
