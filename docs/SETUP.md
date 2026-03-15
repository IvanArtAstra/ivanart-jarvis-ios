# Настройка окружения для разработки

## Требования

- **macOS** Ventura 13+ (для iOS сборки)
- **Xcode** 15+
- **Node.js** 18+ 
- **CocoaPods** (`sudo gem install cocoapods`)
- **iPhone** с iOS 16+ (для тестирования BLE)

## Первый запуск

```bash
# 1. Клонировать репо
git clone https://github.com/IvanArtAstra/ivanart-jarvis-ios.git
cd ivanart-jarvis-ios

# 2. Установить зависимости
npm install

# 3. Установить iOS pods
cd ios && pod install && cd ..

# 4. Создать .env файл
cp .env.example .env
# Заполнить API ключи в .env

# 5. Запустить на симуляторе (BLE не работает на симуляторе!)
npx react-native run-ios

# 6. Запустить на реальном iPhone (нужен Developer Account)
npx react-native run-ios --device "iPhone Name"
```

## Переменные окружения (.env)

```env
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
JARVIS_VOICE_ID=...
BACKEND_URL=http://localhost:8000
```

## Важно для BLE (Ray-Ban)

⚠️ Bluetooth НЕ работает на iOS симуляторе. Тестировать только на реальном iPhone.

1. Включи Ray-Ban очки
2. Убедись что Bluetooth на iPhone включён
3. При первом запуске — дай разрешение на Bluetooth
4. Очки должны быть в режиме сопряжения (подержи кнопку питания)

## Архитектура данных

```
[Ray-Ban Glasses BLE]
        ↕ react-native-ble-plx
[iOS App]
    voiceService.ts  → слушает микрофон
    jarvisService.ts → Claude Sonnet API
    ttsService.ts    → ElevenLabs → BLE / Phone speaker
    bleService.ts    → Nordic UART BLE protocol
        ↕ WebSocket (опционально)
[Backend :8000]
    FastAPI + Claude direct
```

## Фазы разработки

- [x] **Фаза 0** — инициализация проекта, базовые сервисы
- [x] **Фаза 1** — Voice + TTS + BLE подключение (текущая)
- [ ] **Фаза 2** — Display управление (Ray-Ban экран, если поддерживается)
- [ ] **Фаза 3** — Фоновый режим (всегда слушает кодовое слово "Джарвис")
- [ ] **Фаза 4** — Интеграция с агент-системой (workspace)
- [ ] **Фаза 5** — App Store публикация
