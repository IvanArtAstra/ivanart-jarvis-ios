/**
 * SettingsScreen.tsx — Настройки Jarvis v2
 * Backend URL, Bridge URL, Voice ID, connections status
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, Alert,
  Platform,
} from 'react-native';
import {
  getBackendUrl, setBackendUrl,
  getVoiceId, setVoiceId,
  getBridgeUrl, setBridgeUrl,
  BACKEND_URL_DEFAULT, BACKEND_URL_LOCAL,
  BRIDGE_URL_DEFAULT,
} from '../utils/config';
import { agentBridgeService } from '../services/agentBridgeService';

interface Props {
  onClose: () => void;
}

const BRIDGE_PRESETS = [
  { label: '🏠 Tailscale', value: 'ws://100.70.68.84:8766' },
  { label: '🔧 Localhost', value: 'ws://localhost:8766' },
];

export const SettingsScreen: React.FC<Props> = ({ onClose }) => {
  const [bridgeUrl, setBridgeUrlState] = useState('');
  const [voiceId, setVoiceIdState] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setBridgeUrlState(await getBridgeUrl());
      setVoiceIdState(await getVoiceId());
    })();
  }, []);

  const handleSave = async () => {
    await setBridgeUrl(bridgeUrl);
    await setVoiceId(voiceId);
    // Reconnect bridge with new URL
    await agentBridgeService.reconnect(bridgeUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const httpUrl = bridgeUrl
      .replace('ws://', 'http://')
      .replace('wss://', 'https://')
      .replace(/\/$/, '') + '/health';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(httpUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        setTestResult(`✅ Bridge OK! Clients: ${data.clients ?? 0}, Queries: ${data.queries ?? 0}`);
      } else {
        setTestResult(`⚠️ HTTP ${res.status}`);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setTestResult('❌ Timeout — сервер недоступен');
      } else {
        setTestResult(`❌ ${e.message}`);
      }
    }
    setTesting(false);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>⚙️ Настройки</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Bridge URL ── */}
        <Text style={styles.sectionTitle}>🔗 Bridge URL</Text>
        <Text style={styles.hint}>
          WebSocket адрес jarvis_ios_bridge.py (порт 8766).
          Для разработки: bore.pub URL из Telegram.
        </Text>

        <View style={styles.presets}>
          {BRIDGE_PRESETS.map(p => (
            <TouchableOpacity
              key={p.value}
              style={[styles.preset, bridgeUrl === p.value && styles.presetActive]}
              onPress={() => setBridgeUrlState(p.value)}
            >
              <Text style={[styles.presetTxt, bridgeUrl === p.value && styles.presetTxtActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.input}
          value={bridgeUrl}
          onChangeText={setBridgeUrlState}
          placeholder="ws://100.70.68.84:8766"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <TouchableOpacity style={styles.testBtn} onPress={handleTest} disabled={testing}>
          {testing
            ? <ActivityIndicator color="#3B82F6" size="small" />
            : <Text style={styles.testTxt}>🔌 Проверить подключение</Text>
          }
        </TouchableOpacity>
        {testResult && (
          <Text style={[styles.testResult,
            testResult.startsWith('✅') ? styles.ok : styles.err]}>
            {testResult}
          </Text>
        )}

        {/* ── Voice ID ── */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>🎙️ ElevenLabs Voice ID</Text>
        <Text style={styles.hint}>
          ID голоса Jarvis. Найди в ElevenLabs → My Voices.
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

        {/* ── Voice Commands ── */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>📱 Голосовые команды</Text>
        <Text style={styles.hint}>Что умеет Jarvis:</Text>
        {[
          '"Джарвис, какая погода?"',
          '"Джарвис, открой Telegram"',
          '"Джарвис, создай задачу для Prometheus"',
          '"Джарвис, статус системы"',
          '"Джарвис, что нового?"',
        ].map((cmd, i) => (
          <View key={i} style={styles.cmdRow}>
            <Text style={styles.cmdTxt}>{cmd}</Text>
          </View>
        ))}

        {/* ── About ── */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>ℹ️ О приложении</Text>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Версия</Text>
          <Text style={styles.aboutValue}>0.1.0</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Bridge</Text>
          <Text style={[styles.aboutValue,
            agentBridgeService.connected ? { color: '#10B981' } : { color: '#EF4444' }]}>
            {agentBridgeService.connected ? '● Connected' : '● Offline'}
          </Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Model</Text>
          <Text style={styles.aboutValue}>Claude Haiku 3.5</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Save */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveTxt}>
          {saved ? '✅ Сохранено!' : '💾 Сохранить'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  closeBtn: { padding: 8 },
  closeTxt: { color: '#888', fontSize: 20 },
  scroll: { flex: 1, paddingHorizontal: 20 },
  sectionTitle: { color: '#3B82F6', fontSize: 14, fontWeight: '600', marginTop: 24, marginBottom: 6 },
  hint: { color: '#666', fontSize: 12, marginBottom: 12, lineHeight: 18 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  preset: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#333', backgroundColor: '#111',
  },
  presetActive: { borderColor: '#3B82F6', backgroundColor: '#0C1929' },
  presetTxt: { color: '#888', fontSize: 12 },
  presetTxtActive: { color: '#3B82F6' },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#333',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    color: '#fff', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  testBtn: {
    marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: '#3B82F6',
    paddingVertical: 10, alignItems: 'center',
  },
  testTxt: { color: '#3B82F6', fontSize: 14 },
  testResult: { marginTop: 8, fontSize: 13, textAlign: 'center' },
  ok: { color: '#10B981' },
  err: { color: '#EF4444' },
  cmdRow: { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  cmdTxt: { color: '#aaa', fontSize: 13, fontStyle: 'italic' },
  aboutRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  aboutLabel: { color: '#6B7280', fontSize: 13 },
  aboutValue: { color: '#D1D5DB', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  saveBtn: {
    margin: 20, borderRadius: 14, backgroundColor: '#3B82F622',
    borderWidth: 1, borderColor: '#3B82F6', paddingVertical: 14, alignItems: 'center',
  },
  saveTxt: { color: '#3B82F6', fontSize: 16, fontWeight: '700' },
});
