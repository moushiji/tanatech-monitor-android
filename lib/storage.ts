import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  MACHINE_ID:  'tt:machineId',
  SERVER_URL:  'tt:serverUrl',
  MACHINE_NAME:'tt:machineName',
  INTERVAL:    'tt:interval',
  KIOSK:       'tt:kiosk',
  PREV_NET:    'tt:prevNet',
  PREV_CPU:    'tt:prevCpu',
  DAILY_SENT:  'tt:dailySentGb',
  DAILY_RECV:  'tt:dailyRecvGb',
  DAILY_DATE:  'tt:dailyDate',
  MONTH_SENT:  'tt:monthlySentGb',
  MONTH_RECV:  'tt:monthlyRecvGb',
  MONTH_KEY:   'tt:monthlyKey',
  BATCH_QUEUE: 'tt:batchQueue',
};

export const DEFAULT_SERVER = 'https://tanatech-monitor-api.onrender.com/api';
export const DEFAULT_INTERVAL = 5;

function uid(): string {
  return 'android-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export async function getMachineId(): Promise<string> {
  let id = await AsyncStorage.getItem(KEYS.MACHINE_ID);
  if (!id) {
    id = uid();
    await AsyncStorage.setItem(KEYS.MACHINE_ID, id);
  }
  return id;
}

export interface Settings {
  serverUrl:   string;
  machineName: string;
  interval:    number;
  kioskMode:   boolean;
}

export async function getSettings(): Promise<Settings> {
  const [url, name, interval, kiosk] = await AsyncStorage.multiGet([
    KEYS.SERVER_URL, KEYS.MACHINE_NAME, KEYS.INTERVAL, KEYS.KIOSK,
  ]);
  return {
    serverUrl:   url[1]      ?? DEFAULT_SERVER,
    machineName: name[1]     ?? '',
    interval:    interval[1] ? parseInt(interval[1]) : DEFAULT_INTERVAL,
    kioskMode:   kiosk[1]    === '1',
  };
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const pairs: [string, string][] = [];
  if (s.serverUrl   !== undefined) pairs.push([KEYS.SERVER_URL,   s.serverUrl]);
  if (s.machineName !== undefined) pairs.push([KEYS.MACHINE_NAME, s.machineName]);
  if (s.interval    !== undefined) pairs.push([KEYS.INTERVAL,     String(s.interval)]);
  if (s.kioskMode   !== undefined) pairs.push([KEYS.KIOSK,        s.kioskMode ? '1' : '0']);
  if (pairs.length) await AsyncStorage.multiSet(pairs);
}

export interface PrevNet {
  sentBytes: number;
  recvBytes: number;
  ts:        number;
}

export async function getPrevNet(): Promise<PrevNet | null> {
  const raw = await AsyncStorage.getItem(KEYS.PREV_NET);
  return raw ? JSON.parse(raw) : null;
}

export async function setPrevNet(n: PrevNet): Promise<void> {
  await AsyncStorage.setItem(KEYS.PREV_NET, JSON.stringify(n));
}

export interface PrevCpu { total: number; idle: number; ts: number }

export async function getPrevCpu(): Promise<PrevCpu | null> {
  const raw = await AsyncStorage.getItem(KEYS.PREV_CPU);
  return raw ? JSON.parse(raw) : null;
}

export async function setPrevCpu(c: PrevCpu): Promise<void> {
  await AsyncStorage.setItem(KEYS.PREV_CPU, JSON.stringify(c));
}

export interface BwAccum {
  dailySentGb:  number;
  dailyRecvGb:  number;
  dailyDate:    string;
  monthlySentGb:number;
  monthlyRecvGb:number;
  monthlyKey:   string;
}

export async function getBwAccum(): Promise<BwAccum> {
  const vals = await AsyncStorage.multiGet([
    KEYS.DAILY_SENT, KEYS.DAILY_RECV, KEYS.DAILY_DATE,
    KEYS.MONTH_SENT, KEYS.MONTH_RECV, KEYS.MONTH_KEY,
  ]);
  return {
    dailySentGb:   parseFloat(vals[0][1] ?? '0'),
    dailyRecvGb:   parseFloat(vals[1][1] ?? '0'),
    dailyDate:     vals[2][1] ?? '',
    monthlySentGb: parseFloat(vals[3][1] ?? '0'),
    monthlyRecvGb: parseFloat(vals[4][1] ?? '0'),
    monthlyKey:    vals[5][1] ?? '',
  };
}

// ─── File d'attente batch ────────────────────────────────────────────────────

export const BATCH_SIZE = 1; // envoi immédiat toutes les 10 secondes

export async function getBatchQueue(): Promise<object[]> {
  const raw = await AsyncStorage.getItem(KEYS.BATCH_QUEUE);
  return raw ? JSON.parse(raw) : [];
}

export async function pushToBatchQueue(reading: object): Promise<object[]> {
  const queue = await getBatchQueue();
  queue.push(reading);
  await AsyncStorage.setItem(KEYS.BATCH_QUEUE, JSON.stringify(queue));
  return queue;
}

export async function clearBatchQueue(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.BATCH_QUEUE);
}

// ─── Bande passante ──────────────────────────────────────────────────────────

export async function addBwDelta(sentGb: number, recvGb: number): Promise<void> {
  const now   = new Date();
  const day   = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const bw    = await getBwAccum();

  const daily_s = bw.dailyDate === day   ? bw.dailySentGb   + sentGb : sentGb;
  const daily_r = bw.dailyDate === day   ? bw.dailyRecvGb   + recvGb : recvGb;
  const mon_s   = bw.monthlyKey === month? bw.monthlySentGb + sentGb : sentGb;
  const mon_r   = bw.monthlyKey === month? bw.monthlyRecvGb + recvGb : recvGb;

  await AsyncStorage.multiSet([
    [KEYS.DAILY_SENT,  String(daily_s)],
    [KEYS.DAILY_RECV,  String(daily_r)],
    [KEYS.DAILY_DATE,  day],
    [KEYS.MONTH_SENT,  String(mon_s)],
    [KEYS.MONTH_RECV,  String(mon_r)],
    [KEYS.MONTH_KEY,   month],
  ]);
}
