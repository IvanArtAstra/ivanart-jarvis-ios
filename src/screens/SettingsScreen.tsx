/**
 * SettingsScreen.tsx — Настройки Jarvis
 * Изменить backend URL, voice ID, посмотреть статус подключений
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Switch, Alert, ActivityIndicator,
} from 'react-native';
import {
  getBackendUrl, setBackendUrl,
  getVoiceId, setVoiceId,
  BACKEND_URL_DEFAULT, BACKEND_URL_LOCAL,
} from '../utils/config';

interface Props {
  onClose: () => void;
}

const PRESETS = [
  { label: '🏠 Tailscale (везде)', value: 'ws://100.70.68.84:8766' },
  { label: '📡 Локальная сеть',    value: BACKEND_URL_LOCAL },
  { label: '🔧 Localhost',          value: 'ws://localhost:8766' },
];

export const SettingsScreen: React.FC<Props> = ({ onClose }) => {
  const [backendUrl, setBackendUrlState] = useState('');
  const [voiceId, setVoiceIdState] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setBackendUrlState(await getBackendUrl());
      setVoiceIdState(await getVoiceId());
    })();
  }, []);

  const handleSave = async () => {
    await setBackendUrl(backendUrl);
    await setVoiceId(voiceId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const url = backendUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const pingUrl = url.replace(':8766', ':8766').replace(/\/$/, '') + '/health';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(pingUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        setTestResult(`✅ Подключено! Агентов: ${data.agents ?? '?'}`);
      } else {
        setTestResult(`⚠️ Сервер ответил: ${res.status}`);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setTestResult('❌ Таймаут — сервер недоступен');
      } else {
        setTestResult(`❌ Ошибка: ${e.message}`);
      }
    }
    setTesting(false);
  };

  return (
    <View style={styles.container}>
      {/* Шапка */}
      <View style={styles.header}>
        <Text style={styles.title}>⚙️ Настройки</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Backend URL ─────────────────────────────────── */}
        <Text style={styles.sectionTitle}>🌐 Backend URL</Text>
        <Text style={styles.hint}>
          IP-адрес твоего Windows сервера где запущен Agent Bridge (порт 8766)
        </Text>

        {/* Быстрые пресеты */}
        <View style={styles.presets}>
          {PRESETS.map(p => (
            <TouchableOpacity
              key={p.value}
              style={[styles.preset, backendUrl === p.value && styles.presetActive]}
              onPress={() => setBackendUrlState(p.value)}
            >
              <Text style={[styles.presetTxt, backendUrl === p.value && styles.presetTxtActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.input}
          value={backendUrl}
          onChangeText={setBackendUrlState}
          placeholder="ws://100.70.68.84:8766"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        {/* Кнопка теста */}
        <TouchableOpacity style={styles.testBtn} onPress={handleTest} disabled={testing}>
          {testing
            ? <ActivityIndicator color="#00f5ff" size="small" />
            : <Text style={styles.testTxt}>🔌 Проверить подключение</Text>
          }
        </TouchableOpacity>
        {testResult && (
          <Text style={[styles.testResult,
            testResult.startsWith('✅') ? styles.ok : styles.err]}>
            {testResult}
          </Text>
        )}

        {/* ── Voice ID ─────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>🎙️ ElevenLabs Voice ID</Text>
        <Text style={styles.hint}>
          ID голоса Jarvis. Найди свой в ElevenLabs → My Voices.
        </Text>
        <TextInput
          style={styles.input}
          value={voiceId}
          onChangeText={setVoiceIdState}
          placeholder="pNInz6obpgDQGcFmaJgB"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* ── Управление приложениями ────────────────────── */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>📱 Голосовое управление приложениями</Text>
        <Text style={styles.hint}>Что умеет Jarvis:</Text>

        {[
          '"Джарвис, открой Telegram"',
          '"Джарвис, позвони Рае"',
          '"Джарвис, включи Spotify"',
          '"Джарвис, проложи маршрут до центра"',
          '"Джарвис, поищи в ютубе React Native"',
          '"Джарвис, запусти шорткат «Домой»"',
          '"Джарвис, открой настройки"',
        ].map((cmd, i) => (
          <View key={i} style={styles.cmdRow}>
            <Text style={styles.cmdTxt}>{cmd}</Text>
          </View>
        ))}

        <View style={styles.spacer} />
      </ScrollView>

      {/* Кнопка сохранить */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveTxt}>
          {saved ? '✅ Сохранено!' : '💾 Сохранить'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ─── Стили ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  closeBtn: { padding: 8 },
  closeTxt: { color: '#888', fontSize: 20 },
  scroll: { flex: 1, paddingHorizontal: 20 },
  sectionTitle: { color: '#00f5ff', fontSize: 14, fontWeight: '600', marginTop: 24, marginBottom: 6 },
  hint: { color: '#666', fontSize: 12, marginBottom: 12, lineHeight: 18 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  preset: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#333',
    backgroundColor: '#111',
  },
  presetActive: { borderColor: '#00f5ff', backgroundColor: '#001a1f' },
  presetTxt: { color: '#888', fontSize: 12 },
  presetTxtActive: { color: '#00f5ff' },
  input: {
    backgroundColor: '#111',
    borderWidth: 1, borderColor: '#333',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    color: '#fff', fontSize: 14, fontFamily: 'Courier New',
  },
  testBtn: {
    marginTop: 10, borderRadius: 10,
    borderWidth: 1, borderColor: '#00f5ff',
    paddingVertical: 10, alignItems: 'center',
  },
  testTxt: { color: '#00f5ff', fontSize: 14 },
  testResult: { marginTop: 8, fontSize: 13, textAlign: 'center' },
  ok: { color: '#00ff88' },
  err: { color: '#ff4466' },
  cmdRow: {
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  cmdTxt: { color: '#aaa', fontSize: 13, fontStyle: 'italic' },
  spacer: { height: 40 },
  saveBtn: {
    margin: 20, borderRadius: 14,
    backgroundColor: '#00f5ff22',
    borderWidth: 1, borderColor: '#00f5ff',
    paddingVertical: 14, alignItems: 'center',
  },
  saveTxt: { color: '#00f5ff', fontSize: 16, fontWeight: '700' },
});
