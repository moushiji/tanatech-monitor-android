import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, AppState, AppStateStatus, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as KeepAwake from 'expo-keep-awake';
import { Colors } from '@/constants/colors';
import { sendHeartbeat, ackCommand, selfUninstall, HeartbeatResult } from '@/lib/agent';
import { getSettings, saveSettings, getMachineId, Settings } from '@/lib/storage';
import { registerBackgroundTask, unregisterBackgroundTask, startForegroundService, isForegroundServiceRunning } from '@/lib/tasks';

const FOREGROUND_INTERVAL_MS = 30_000; // 30 secondes — toujours actif au premier plan

function fmt(n: number, dec = 1) { return n.toFixed(dec); }
function fmtTime(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function colorForPercent(p: number, inverse = false) {
  if (inverse) {
    if (p < 20) return Colors.red;
    if (p < 50) return Colors.orange;
    return Colors.green;
  }
  if (p > 90) return Colors.red;
  if (p > 70) return Colors.orange;
  return Colors.green;
}

function MetricCard({
  icon, label, value, color, sub,
}: { icon: string; label: string; value: string; color: string; sub?: string }) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon as any} size={20} color={color} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      {sub ? <Text style={styles.metricSub}>{sub}</Text> : null}
    </View>
  );
}

function BarIndicator({ percent, color }: { percent: number; color: string }) {
  return (
    <View style={styles.barBg}>
      <View style={[styles.barFill, { width: `${Math.min(100, percent)}%` as any, backgroundColor: color }]} />
    </View>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const [result,    setResult]    = useState<HeartbeatResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [settings,  setSettings]  = useState<Settings | null>(null);
  const [kiosk,     setKiosk]     = useState(false);
  const [pulseAnim, setPulseAnim] = useState(false);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');

  const loadSettings = useCallback(async () => {
    const s = await getSettings();
    setSettings(s);
    setKiosk(s.kioskMode);
    return s;
  }, []);

  const handleCommands = useCallback(async (res: HeartbeatResult) => {
    if (!res.ok || !res.commands || res.commands.length === 0) return;
    const [machineId, s] = await Promise.all([getMachineId(), getSettings()]);
    for (const cmd of res.commands) {
      await ackCommand(s.serverUrl, machineId, cmd.id);
      if (cmd.command === 'uninstall') {
        await selfUninstall(s.serverUrl, machineId);
        await unregisterBackgroundTask(); // arrête aussi le foreground service
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        Alert.alert(
          'Désinstallation demandée',
          'L\'agent a été retiré du tableau de bord TANATECH.\n\nPour supprimer complètement l\'application, allez dans Paramètres → Applications → TANATECH Monitor → Désinstaller.',
          [{ text: 'OK' }],
        );
      } else if (cmd.command === 'force_refresh') {
        setTimeout(() => beat(), 500);
      }
    }
  }, []);

  const beat = useCallback(async () => {
    setLoading(true);
    setPulseAnim(true);
    try {
      const res = await sendHeartbeat();
      setResult(res);
      if (res.ok) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        handleCommands(res);
      }
    } finally {
      setLoading(false);
      setTimeout(() => setPulseAnim(false), 600);
    }
  }, [handleCommands]);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (appStateRef.current === 'active') beat();
    }, FOREGROUND_INTERVAL_MS);
  }, [beat]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadSettings();
      if (cancelled) return;
      await beat();
      startTimer();
      await registerBackgroundTask(Math.max(15, s.interval));
      await startForegroundService();
    })();

    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        beat();
        startTimer();
      } else {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      }
    });

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (kiosk) {
      KeepAwake.activateKeepAwakeAsync();
    } else {
      KeepAwake.deactivateKeepAwake();
    }
  }, [kiosk]);

  const toggleKiosk = async () => {
    const next = !kiosk;
    setKiosk(next);
    await saveSettings({ kioskMode: next });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const online  = !!result?.ok;
  const battery = result?.battery ?? 0;
  const disk    = result?.disk    ?? 0;
  const cpu     = result?.cpu     ?? 0;
  const ram     = result?.ram     ?? 0;

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={beat} tintColor={Colors.accent} />}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>TanaTech Agent</Text>
          <Text style={styles.deviceName}>{settings?.machineName || 'Appareil Android'}</Text>
        </View>
        <TouchableOpacity onPress={toggleKiosk} style={[styles.kioskBtn, kiosk && styles.kioskActive]}>
          <Ionicons name={kiosk ? 'eye' : 'eye-outline'} size={18} color={kiosk ? Colors.accent : Colors.sub} />
          <Text style={[styles.kioskLabel, kiosk && { color: Colors.accent }]}>Kiosk</Text>
        </TouchableOpacity>
      </View>

      {/* ── Status card ── */}
      <View style={[styles.statusCard, { borderColor: online ? Colors.green : Colors.red }]}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: online ? Colors.green : Colors.red }, pulseAnim && styles.dotPulse]} />
          <Text style={[styles.statusText, { color: online ? Colors.green : Colors.red }]}>
            {loading ? 'Collecte...' : online ? 'EN LIGNE' : 'HORS LIGNE'}
          </Text>
          {loading && <ActivityIndicator size="small" color={Colors.accent} style={{ marginLeft: 8 }} />}
        </View>
        <Text style={styles.lastBeat}>
          Dernier envoi serveur : {result && !result.queued ? fmtTime(result.sentAt) : '—'}
        </Text>
        {result?.queued ? (
          <Text style={styles.batchText}>
            📦 {result.queueLen ?? 0}/{10} mesures en file · envoi dans ~{((10 - (result.queueLen ?? 0)) * 30)}s
          </Text>
        ) : null}
        {result?.error ? (
          <Text style={styles.errorText}>⚠ {result.error}</Text>
        ) : null}
      </View>

      {/* ── Metric cards 3×2 ── */}
      <View style={styles.gridRow}>
        <MetricCard
          icon="battery-half"
          label="Batterie"
          value={`${battery} %`}
          color={colorForPercent(battery, true)}
          sub={result?.ok ? (battery < 20 ? 'Faible !' : battery > 80 ? 'Bonne' : 'Moyenne') : undefined}
        />
        <MetricCard
          icon="server"
          label="Stockage"
          value={`${fmt(disk)} %`}
          color={colorForPercent(disk)}
        />
      </View>
      <View style={styles.gridRow}>
        <MetricCard
          icon="pulse"
          label="CPU"
          value={`${cpu} %`}
          color={colorForPercent(cpu)}
          sub={cpu === 0 ? 'en attente' : undefined}
        />
        <MetricCard
          icon="hardware-chip"
          label="RAM"
          value={`${ram} %`}
          color={colorForPercent(ram)}
        />
      </View>
      <View style={styles.gridRow}>
        <MetricCard
          icon={result?.networkType === 'WiFi' ? 'wifi' : result?.networkType === 'Cellulaire' ? 'cellular' : 'cloud-offline-outline'}
          label="Réseau"
          value={result?.networkType ?? '—'}
          color={result?.networkType === 'Hors ligne' ? Colors.red : Colors.accent}
        />
        <MetricCard
          icon="speedometer"
          label={result?.procNet ? 'Débit (proc)' : 'Débit'}
          value={result?.procNet
            ? `↑${fmt(result.netSentMbps)} ↓${fmt(result.netRecvMbps)}`
            : 'N/A'}
          color={result?.procNet ? Colors.purple : Colors.sub}
          sub={result?.procNet ? 'Mbps' : 'Android 13+'}
        />
      </View>

      {/* ── Bars ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Batterie</Text>
        <BarIndicator percent={battery} color={colorForPercent(battery, true)} />
        <Text style={[styles.barLabel, { color: colorForPercent(battery, true) }]}>{battery} %</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CPU</Text>
        <BarIndicator percent={cpu} color={colorForPercent(cpu)} />
        <Text style={[styles.barLabel, { color: colorForPercent(cpu) }]}>{cpu} %</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>RAM</Text>
        <BarIndicator percent={ram} color={colorForPercent(ram)} />
        <Text style={[styles.barLabel, { color: colorForPercent(ram) }]}>{ram} %</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Stockage utilisé</Text>
        <BarIndicator percent={disk} color={colorForPercent(disk)} />
        <Text style={[styles.barLabel, { color: colorForPercent(disk) }]}>{fmt(disk)} %</Text>
      </View>

      {/* ── /proc/net/dev status ── */}
      <View style={[styles.infoBox, { borderColor: result?.procNet ? Colors.green + '44' : Colors.orange + '44' }]}>
        <Ionicons
          name={result?.procNet ? 'checkmark-circle' : 'alert-circle-outline'}
          size={16}
          color={result?.procNet ? Colors.green : Colors.orange}
        />
        <Text style={styles.infoText}>
          {result?.procNet
            ? 'Consommation réseau disponible via /proc/net/dev'
            : 'Consommation réseau non disponible (Android 13+) — débit affiché à 0'}
        </Text>
      </View>

      {/* ── Manual send button ── */}
      <TouchableOpacity style={styles.sendBtn} onPress={beat} disabled={loading}>
        <Ionicons name="send" size={18} color={Colors.bg} />
        <Text style={styles.sendBtnText}>Envoyer heartbeat maintenant</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>
        Service permanent actif · Heartbeat toutes les 30 s · Démarre au boot
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: Colors.bg },
  content:     { padding: 16, paddingBottom: 32 },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  appName:     { fontFamily: 'Inter_700Bold', fontSize: 20, color: Colors.text },
  deviceName:  { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.sub, marginTop: 2 },
  kioskBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  kioskActive: { borderColor: Colors.accent + '88', backgroundColor: Colors.accent + '15' },
  kioskLabel:  { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.sub },

  statusCard:  { borderRadius: 12, borderWidth: 1.5, backgroundColor: Colors.card, padding: 16, marginBottom: 16 },
  statusRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  dot:         { width: 10, height: 10, borderRadius: 5 },
  dotPulse:    { opacity: 0.6 },
  statusText:  { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: 1 },
  lastBeat:    { fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.sub },
  errorText:   { fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.orange, marginTop: 4 },
  batchText:   { fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.accent, marginTop: 4 },

  gridRow:     { flexDirection: 'row', gap: 12, marginBottom: 12 },
  metricCard:  { flex: 1, backgroundColor: Colors.card, borderRadius: 12, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border },
  metricLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: Colors.sub, textAlign: 'center' },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 16, textAlign: 'center' },
  metricSub:   { fontFamily: 'Inter_400Regular', fontSize: 10, color: Colors.sub, textAlign: 'center' },

  section:     { backgroundColor: Colors.card, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  sectionTitle:{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.text, marginBottom: 10 },
  barBg:       { height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  barFill:     { height: '100%', borderRadius: 4 },
  barLabel:    { fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 6, textAlign: 'right' },

  infoBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 16 },
  infoText:    { fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.sub, flex: 1, lineHeight: 18 },

  sendBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 14, marginBottom: 12 },
  sendBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.bg },
  footer:      { fontFamily: 'Inter_400Regular', fontSize: 11, color: Colors.sub, textAlign: 'center' },
});
