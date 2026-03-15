# IvanArt × Jarvis — iOS App

> Управляй Meta Ray-Ban Display голосом и ИИ. Два разума, одни очки. ⚡

## Концепция

Мобильное iOS приложение которое соединяет:
- **Meta Ray-Ban Smart Glasses** (через BLE)
- **Claude AI (Jarvis)** — мозг системы
- **Голосовое управление** — Whisper STT
- **TTS ответы** — прямо в динамики очков

## Стек

- **React Native** (iOS-first)
- **BLE** — react-native-ble-plx для связи с очками
- **Whisper** — распознавание речи
- **Anthropic Claude API** — ИИ обработка
- **ElevenLabs / SAG** — синтез голоса Jarvis
- **Node.js** — backend bridge

## Архитектура

```
[Ray-Ban Glasses]
      ↕ BLE
[iOS App (RN)]
      ↕ WebSocket
[Jarvis Backend]
      ↕ API
[Claude + Whisper + TTS]
```

## Фазы разработки

- [ ] **Фаза 1** — BLE подключение к очкам, базовый UI
- [ ] **Фаза 2** — Голосовой ввод (Whisper), отправка в Claude
- [ ] **Фаза 3** — TTS ответы через динамики очков
- [ ] **Фаза 4** — Display управление (нотификации, оверлей)
- [ ] **Фаза 5** — Полная интеграция Jarvis команд

## Быстрый старт

```bash
git clone https://github.com/IvanArtAstra/ivanart-jarvis-ios.git
cd ivanart-jarvis-ios
npm install
cd ios && pod install && cd ..
npx react-native run-ios
```

## Требования

- macOS с Xcode 15+
- Node.js 18+
- iPhone с iOS 16+
- Meta Ray-Ban Smart Glasses (2-го поколения)

---

**IvanArt × Jarvis** | Два разума, одни очки ⚡
