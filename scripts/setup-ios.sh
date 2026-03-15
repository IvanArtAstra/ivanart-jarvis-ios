#!/bin/bash
# setup-ios.sh — инициализация React Native iOS проекта
# Запускать из: ~/Documents/ivanart-jarvis-ios/
# Использование: bash scripts/setup-ios.sh

set -e  # остановить при любой ошибке

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  IvanArt × Jarvis — iOS Setup Script${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

REPO_DIR="$(pwd)"
PARENT_DIR="$(dirname "$REPO_DIR")"
TEMP_APP="$PARENT_DIR/IvanArtJarvisTemp"

# ─── Шаг 1: Инициализация нативного RN проекта ────────────────
echo -e "\n${CYAN}[1/5] Создаём нативный React Native проект...${NC}"
cd "$PARENT_DIR"

if [ -d "$TEMP_APP" ]; then
  echo "  Папка уже существует, удаляем..."
  rm -rf "$TEMP_APP"
fi

npx @react-native-community/cli@latest init IvanArtJarvisTemp \
  --pm npm \
  --version 0.73.0

echo -e "${GREEN}  ✓ Нативный проект создан${NC}"

# ─── Шаг 2: Копируем ios/ из шаблона в наш репо ──────────────
echo -e "\n${CYAN}[2/5] Копируем iOS нативные файлы...${NC}"
cd "$REPO_DIR"

# Удаляем старую пустую папку ios/
rm -rf ios/
cp -r "$TEMP_APP/ios/" ios/

# Переименовываем папки СНАЧАЛА
if [ -d "ios/IvanArtJarvisTemp" ]; then
  mv ios/IvanArtJarvisTemp ios/IvanArtJarvis
fi
if [ -d "ios/IvanArtJarvisTemp.xcodeproj" ]; then
  mv ios/IvanArtJarvisTemp.xcodeproj ios/IvanArtJarvis.xcodeproj
fi
if [ -d "ios/IvanArtJarvisTemp.xcworkspace" ]; then
  mv ios/IvanArtJarvisTemp.xcworkspace ios/IvanArtJarvis.xcworkspace
fi

# Потом заменяем имя внутри файлов
find ios/ -type f \( -name "*.swift" -o -name "*.m" -o -name "*.h" -o -name "*.pbxproj" -o -name "*.plist" -o -name "Podfile" \) \
  -exec sed -i '' 's/IvanArtJarvisTemp/IvanArtJarvis/g' {} \;

echo -e "${GREEN}  ✓ iOS файлы скопированы${NC}"

# ─── Шаг 3: Обновляем Info.plist с нашими разрешениями ────────
echo -e "\n${CYAN}[3/5] Добавляем разрешения в Info.plist...${NC}"
PLIST="ios/IvanArtJarvis/Info.plist"

if [ -f "$PLIST" ]; then
  # Добавляем разрешения перед </dict>
  /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string 'Jarvis слушает твои голосовые команды'" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :NSBluetoothAlwaysUsageDescription string 'Для подключения к Meta Ray-Ban Smart Glasses'" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :NSBluetoothPeripheralUsageDescription string 'Для связи с Ray-Ban через Bluetooth'" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :NSSpeechRecognitionUsageDescription string 'Для распознавания голосовых команд Jarvis'" "$PLIST" 2>/dev/null || true
  echo -e "${GREEN}  ✓ Разрешения добавлены${NC}"
else
  echo -e "${RED}  ⚠ Info.plist не найден, пропускаем${NC}"
fi

# ─── Шаг 4: Копируем App.tsx из нашего репо в шаблон ─────────
echo -e "\n${CYAN}[4/5] Копируем App.tsx...${NC}"
cp App.tsx "$TEMP_APP/App.tsx" 2>/dev/null || true
echo -e "${GREEN}  ✓ App.tsx на месте${NC}"

# ─── Шаг 5: pod install ───────────────────────────────────────
echo -e "\n${CYAN}[5/5] Устанавливаем iOS зависимости (pod install)...${NC}"
cd ios/
pod install
cd ..

echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✅ Готово! Теперь запусти:${NC}"
echo -e "${GREEN}  npx react-native run-ios --device${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Чистим временный проект
rm -rf "$TEMP_APP"
echo -e "\n${CYAN}  Временные файлы удалены.${NC}"
