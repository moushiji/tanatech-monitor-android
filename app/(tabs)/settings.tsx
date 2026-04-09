import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { getSettings, saveSettings, getMachineId, Settings, DEFAULT_SERVER } from '@/lib/storage';

const INTERVALS = [5, 10, 15, 30];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [serverUrl,   setServerUrl]   = useState(DEFAULT_SERVER);
  const [machineName, setMachineName] = useState('');
  const [interval,    setInterval]    = useState(5);
  const [machineId,   setMachineId]   = useState('');
  const [saving,      setSaving]      = useState(false);
  const [testing,     setTesting]     = useState(false);
  const [testResult,  setTestResult]  = useState<'ok' | 'err' | null>(null);

  useEffect(() => {
    (async () => {
      const [s, id] = await Promise.all([getSettings(), getMachineId()]);
      setServerUrl(s.serverUrl);
      setMachineName(s.machineName);
      setInterval(s.interval);
      setMachineId(id);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings({ serverUrl, machineName, interval });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Sauvegardé', 'Paramètres mis à jour. Redémarrez l\'app pour appliquer le nouvel intervalle.');
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder.');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${serverUrl}/health`, { method: 'GET' });
      setTestResult(res.ok ? 'ok' : 'err');
    } catch {
      setTestResult('err');
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Paramètres</Text>

      {/* ── Server URL ── */}
      <View style={styles.section}>
        <Text style={styles.label}>URL du serveur</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholderTextColor={Colors.sub}
          placeholder="https://..."
        />
        <TouchableOpacity style={styles.testBtn} onPress={testConnection} disabled={testing}>
          {testing
            ? <ActivityIndicator size="small" color={Colors.accent} />
            : <Ionicons name="wifi" size={16} color={Colors.accent} />}
          <Text style={styles.testBtnText}>Tester la connexion</Text>
          {testResult === 'ok'  && <Ionicons name="checkmark-circle" size={16} color={Colors.green} />}
          {testResult === 'err' && <Ionicons name="close-circle"     size={16} color={Colors.red}   />}
        </TouchableOpacity>
      </View>

      {/* ── Machine name ── */}
      <View style={styles.section}>
        <Text style={styles.label}>Nom de l'appareil</Text>
        <Text style={styles.hint}>Laissez vide pour utiliser le nom détecté automatiquement.</Text>
        <TextInput
          style={styles.input}
          value={machineName}
          onChangeText={setMachineName}
          placeholder="Ex : Téléphone Direction, Tablette Entrepôt..."
          placeholderTextColor={Colors.sub}
        />
      </View>

      {/* ── Heartbeat interval ── */}
      <View style={styles.section}>
        <Text style={styles.label}>Intervalle heartbeat (premier plan)</Text>
        <Text style={styles.hint}>En arrière-plan, le minimum est 15 min sur Expo Go.</Text>
        <View style={styles.intervalRow}>
          {INTERVALS.map((i) => (
            <TouchableOpacity
              key={i}
              style={[styles.intervalBtn, interval === i && styles.intervalBtnActive]}
              onPress={() => { setInterval(i); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Text style={[styles.intervalBtnText, interval === i && { color: Colors.accent }]}>
                {i} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Machine ID ── */}
      <View style={styles.section}>
        <Text style={styles.label}>Identifiant unique (machine_id)</Text>
        <Text style={styles.idText}>{machineId || '—'}</Text>
        <Text style={styles.hint}>Cet identifiant est généré automatiquement et permanent.</Text>
      </View>

      {/* ── /proc/net/dev info ── */}
      <View style={[styles.section, { borderColor: Colors.purple + '44' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.purple} />
          <Text style={[styles.label, { color: Colors.purple, marginBottom: 0 }]}>Consommation réseau</Text>
        </View>
        <Text style={styles.hint}>
          L'app lit <Text style={{ color: Colors.text, fontFamily: 'Inter_600SemiBold' }}>/proc/net/dev</Text> (Linux) pour mesurer les octets WiFi et cellulaire.{'\n\n'}
          ✅ Fonctionne sur Android ≤ 12{'\n'}
          ⚠️  Android 13+ : dépend du fabricant{'\n'}
          ❌  Si bloqué, le débit s'affiche à 0 et un badge l'indique.{'\n\n'}
          Pour un accès garanti sur tous les Android, compilez un APK natif avec <Text style={{ color: Colors.text }}>TrafficStats</Text>.
        </Text>
      </View>

      {/* ── Save button ── */}
      <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
        {saving
          ? <ActivityIndicator size="small" color={Colors.bg} />
          : <Ionicons name="checkmark" size={20} color={Colors.bg} />}
        <Text style={styles.saveBtnText}>Sauvegarder</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:              { flex: 1, backgroundColor: Colors.bg },
  content:           { padding: 16, paddingBottom: 48 },
  title:             { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.text, marginBottom: 20 },

  section:           { backgroundColor: Colors.card, borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: Colors.border },
  label:             { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.text, marginBottom: 8 },
  hint:              { fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.sub, marginBottom: 10, lineHeight: 18 },

  input:             { backgroundColor: Colors.bg, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, color: Colors.text, fontFamily: 'Inter_400Regular', fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },

  testBtn:           { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  testBtnText:       { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.accent },

  intervalRow:       { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  intervalBtn:       { borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 8 },
  intervalBtnActive: { borderColor: Colors.accent, backgroundColor: Colors.accent + '15' },
  intervalBtnText:   { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.sub },

  idText:            { fontFamily: 'Inter_400Regular', fontSize: 11, color: Colors.sub, letterSpacing: 0.5 },

  saveBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 14 },
  saveBtnText:       { fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.bg },
});
