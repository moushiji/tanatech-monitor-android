import { Platform } from 'react-native';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';

export interface RawNetStats {
  sentBytes: number;
  recvBytes: number;
  ts:        number;
}

export interface RawCpuStats {
  total: number;
  idle:  number;
  ts:    number;
}

export interface DeviceMetrics {
  batteryPercent:    number;
  batteryCharging:   boolean;
  cpuPercent:        number;
  cpuCores:          number;
  ramPercent:        number;
  ramUsedGb:         number;
  ramTotalGb:        number;
  diskPercent:       number;
  diskUsedGb:        number;
  diskTotalGb:       number;
  networkType:       string;
  ipAddress:         string;
  hostname:          string;
  os:                string;
  uptime:            number;
  netSentMbps:       number;
  netRecvMbps:       number;
  netSentTotalGb:    number;
  netRecvTotalGb:    number;
  latitude?:         number;
  longitude?:        number;
  procNetAvailable:  boolean;
  machineBrand:      string;
  machineModel:      string;
  cpuModel:          string;
  diskType:          string;
}

// ─── /proc/stat CPU parser (Android only) ─────────────────────────────────────
// First line: cpu user nice system idle iowait irq softirq steal ...
export async function readProcStat(): Promise<RawCpuStats | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const content = await FileSystem.readAsStringAsync('file:///proc/stat');
    const firstLine = content.split('\n')[0];
    const nums = firstLine.trim().replace(/^cpu\s+/, '').split(/\s+/).map(Number);
    if (nums.length < 4) return null;
    const idle  = (nums[3] ?? 0) + (nums[4] ?? 0); // idle + iowait
    const total = nums.reduce((s, n) => s + (isNaN(n) ? 0 : n), 0);
    return { total, idle, ts: Date.now() };
  } catch {
    return null;
  }
}

// ─── /proc/meminfo RAM parser (Android only) ──────────────────────────────────
async function getMemInfo(): Promise<{ totalKb: number; availableKb: number } | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const content = await FileSystem.readAsStringAsync('file:///proc/meminfo');
    let totalKb = 0;
    let availableKb = 0;
    for (const line of content.split('\n')) {
      if (line.startsWith('MemTotal:'))     totalKb     = parseInt(line.split(/\s+/)[1] ?? '0');
      if (line.startsWith('MemAvailable:')) availableKb = parseInt(line.split(/\s+/)[1] ?? '0');
    }
    return totalKb > 0 ? { totalKb, availableKb } : null;
  } catch {
    return null;
  }
}

// ─── /proc/net/dev parser (Android only) ──────────────────────────────────────
// Format: iface: recv_bytes recv_pkts ... (8 fields) sent_bytes sent_pkts ...
function parseProcNetDev(content: string): { sentBytes: number; recvBytes: number } {
  let sentBytes = 0;
  let recvBytes = 0;

  for (const line of content.split('\n')) {
    const t = line.trim();
    // Match WiFi (wlan*) and cellular (rmnet*, ccmni*, v4-rmnet*)
    if (!t.match(/^(wlan|rmnet|ccmni|v4-rmnet|r_rmnet)/)) continue;

    // Split on colon then whitespace: ["wlan0", "recv_bytes", ...]
    const colonIdx = t.indexOf(':');
    if (colonIdx < 0) continue;
    const nums = t.slice(colonIdx + 1).trim().split(/\s+/).map(Number);
    if (nums.length < 9) continue;

    recvBytes += nums[0]; // bytes received
    sentBytes += nums[8]; // bytes transmitted
  }
  return { sentBytes, recvBytes };
}

export async function readProcNetDev(): Promise<RawNetStats | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const content = await FileSystem.readAsStringAsync('file:///proc/net/dev');
    const { sentBytes, recvBytes } = parseProcNetDev(content);
    return { sentBytes, recvBytes, ts: Date.now() };
  } catch {
    return null;
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────────
async function getStorageInfo(): Promise<{ usedGb: number; totalGb: number; percent: number }> {
  try {
    const free  = await FileSystem.getFreeDiskStorageAsync();
    const total = await FileSystem.getTotalDiskCapacityAsync();
    const used  = total - free;
    const usedGb  = used  / 1e9;
    const totalGb = total / 1e9;
    const percent = totalGb > 0 ? (usedGb / totalGb) * 100 : 0;
    return { usedGb, totalGb, percent };
  } catch {
    return { usedGb: 0, totalGb: 0, percent: 0 };
  }
}

// ─── Main metrics collector ───────────────────────────────────────────────────
export async function collectMetrics(
  prevNet: RawNetStats | null,
  prevCpu: RawCpuStats | null = null,
): Promise<{ metrics: DeviceMetrics; rawNet: RawNetStats | null; rawCpu: RawCpuStats | null }> {

  const [battLevel, battState, netState, storage, newNet, memInfo, newCpu] = await Promise.allSettled([
    Battery.getBatteryLevelAsync(),
    Battery.getBatteryStateAsync(),
    Network.getNetworkStateAsync(),
    getStorageInfo(),
    readProcNetDev(),
    getMemInfo(),
    readProcStat(),
  ]);

  const batteryPercent  = battLevel.status  === 'fulfilled' ? Math.round((battLevel.value  ?? 0) * 100) : 0;
  const batteryCharging = battState.status  === 'fulfilled'
    ? battState.value === Battery.BatteryState.CHARGING || battState.value === Battery.BatteryState.FULL
    : false;

  const networkTypeRaw = netState.status === 'fulfilled' ? netState.value.type : null;
  const networkType = (() => {
    if (!networkTypeRaw) return 'Inconnu';
    if (networkTypeRaw === Network.NetworkStateType.WIFI)     return 'WiFi';
    if (networkTypeRaw === Network.NetworkStateType.CELLULAR) return 'Cellulaire';
    if (networkTypeRaw === Network.NetworkStateType.NONE)     return 'Hors ligne';
    return 'Autre';
  })();

  const ipAddress = await Network.getIpAddressAsync().catch(() => '0.0.0.0');

  const { usedGb, totalGb, percent: diskPercent } =
    storage.status === 'fulfilled' ? storage.value : { usedGb: 0, totalGb: 0, percent: 0 };

  const rawNet = newNet.status === 'fulfilled' ? newNet.value : null;
  let netSentMbps = 0;
  let netRecvMbps = 0;
  let netSentTotalGb = 0;
  let netRecvTotalGb = 0;

  if (rawNet && prevNet && rawNet.ts > prevNet.ts) {
    const dt   = (rawNet.ts - prevNet.ts) / 1000;
    const ds   = Math.max(0, rawNet.sentBytes - prevNet.sentBytes);
    const dr   = Math.max(0, rawNet.recvBytes - prevNet.recvBytes);
    netSentMbps    = dt > 0 ? (ds * 8) / (dt * 1e6) : 0;
    netRecvMbps    = dt > 0 ? (dr * 8) / (dt * 1e6) : 0;
    netSentTotalGb = rawNet.sentBytes / 1e9;
    netRecvTotalGb = rawNet.recvBytes / 1e9;
  } else if (rawNet) {
    netSentTotalGb = rawNet.sentBytes / 1e9;
    netRecvTotalGb = rawNet.recvBytes / 1e9;
  }

  // ─── CPU % from /proc/stat delta ──────────────────────────────────────────
  const rawCpu = newCpu.status === 'fulfilled' ? newCpu.value : null;
  let cpuPercent = 0;
  if (rawCpu && prevCpu && rawCpu.ts > prevCpu.ts) {
    const dTotal = rawCpu.total - prevCpu.total;
    const dIdle  = rawCpu.idle  - prevCpu.idle;
    cpuPercent = dTotal > 0 ? Math.min(100, Math.max(0, Math.round(((dTotal - dIdle) / dTotal) * 100))) : 0;
  }
  const cpuCores = Platform.OS === 'android' ? (Device.supportedCpuArchitectures?.length ?? 1) : 1;

  // ─── RAM from /proc/meminfo ────────────────────────────────────────────────
  const memData = memInfo.status === 'fulfilled' ? memInfo.value : null;
  let ramPercent = 0;
  let ramUsedGb  = 0;
  let ramTotalGb = 0;
  if (memData && memData.totalKb > 0) {
    const usedKb = memData.totalKb - memData.availableKb;
    ramTotalGb = Math.round((memData.totalKb / (1024 * 1024)) * 100) / 100;
    ramUsedGb  = Math.round((usedKb       / (1024 * 1024)) * 100) / 100;
    ramPercent = Math.round((usedKb / memData.totalKb) * 100);
  }

  // GPS (best-effort, doesn't block heartbeat)
  let latitude: number | undefined;
  let longitude: number | undefined;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        mayShowUserSettingsDialog: false,
      });
      latitude  = pos.coords.latitude;
      longitude = pos.coords.longitude;
    }
  } catch { /* GPS not available */ }

  const hostname     = Device.deviceName ?? Device.modelName ?? 'Android';
  const os           = `Android ${Device.osVersion ?? ''}`.trim();
  const machineBrand = Device.manufacturer ?? 'Inconnu';
  const machineModel = Device.modelName ?? 'Inconnu';
  const cpuArch      = (Device.supportedCpuArchitectures ?? []).join(', ') || 'ARM';
  const cpuModel     = `${cpuArch} (${Device.deviceYearClass ?? '?'})`;
  const diskType     = 'Flash (eMMC/UFS)';

  const metrics: DeviceMetrics = {
    batteryPercent,
    batteryCharging,
    cpuPercent,
    cpuCores,
    ramPercent,
    ramUsedGb,
    ramTotalGb,
    diskPercent,
    diskUsedGb: usedGb,
    diskTotalGb: totalGb,
    networkType,
    ipAddress,
    hostname,
    os,
    uptime: 0,
    netSentMbps,
    netRecvMbps,
    netSentTotalGb,
    netRecvTotalGb,
    latitude,
    longitude,
    procNetAvailable: !!rawNet,
    machineBrand,
    machineModel,
    cpuModel,
    diskType,
  };

  return { metrics, rawNet, rawCpu };
}
