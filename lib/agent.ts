import {
  getMachineId, getSettings, getPrevNet, setPrevNet, addBwDelta,
  getPrevCpu, setPrevCpu, pushToBatchQueue, clearBatchQueue, BATCH_SIZE,
} from './storage';
import { collectMetrics } from './metrics';

export interface HeartbeatResult {
  ok:          boolean;
  queued?:     boolean;       // true = accumulé, pas encore envoyé
  queueLen?:   number;        // nombre de mesures en attente
  error?:      string;
  sentAt:      number;
  networkType: string;
  battery:     number;
  disk:        number;
  cpu:         number;
  ram:         number;
  netSentMbps: number;
  netRecvMbps: number;
  procNet:     boolean;
  commands:    ServerCommand[];
}

export interface ServerCommand {
  id:      number;
  command: string;
}

export async function sendHeartbeat(): Promise<HeartbeatResult> {
  const [machineId, settings] = await Promise.all([getMachineId(), getSettings()]);
  const [prevNet, prevCpu]    = await Promise.all([getPrevNet(), getPrevCpu()]);

  const { metrics, rawNet, rawCpu } = await collectMetrics(prevNet, prevCpu);

  if (rawNet) {
    await setPrevNet(rawNet);
    if (prevNet && rawNet.sentBytes > prevNet.sentBytes) {
      const ds = (rawNet.sentBytes - prevNet.sentBytes) / 1e9;
      const dr = (rawNet.recvBytes - prevNet.recvBytes) / 1e9;
      if (ds + dr > 0) await addBwDelta(ds, dr);
    }
  }
  if (rawCpu) await setPrevCpu(rawCpu);

  const now     = new Date();
  const bwDate  = now.toISOString().slice(0, 10);
  const bwMonth = now.toISOString().slice(0, 7);

  const reading = {
    machineId,
    hostname:          settings.machineName || metrics.hostname,
    ipAddress:         metrics.ipAddress,
    os:                metrics.os,
    cpuPercent:        metrics.cpuPercent,
    cpuCores:          metrics.cpuCores,
    ramPercent:        metrics.ramPercent,
    ramUsedGb:         Math.round(metrics.ramUsedGb  * 100) / 100,
    ramTotalGb:        Math.round(metrics.ramTotalGb * 100) / 100,
    diskPercent:       Math.round(metrics.diskPercent * 10) / 10,
    diskUsedGb:        Math.round(metrics.diskUsedGb  * 100) / 100,
    diskTotalGb:       Math.round(metrics.diskTotalGb * 100) / 100,
    netSentMbps:       Math.round(metrics.netSentMbps  * 100) / 100,
    netRecvMbps:       Math.round(metrics.netRecvMbps  * 100) / 100,
    netSentTotalGb:    Math.round(metrics.netSentTotalGb * 1000) / 1000,
    netRecvTotalGb:    Math.round(metrics.netRecvTotalGb * 1000) / 1000,
    uptime:            0,
    batteryPercent:    metrics.batteryPercent,
    batteryCharging:   metrics.batteryCharging ? 1 : 0,
    deviceType:        'phone',
    bwDate,
    bwMonth,
    bwDailySentGb:     Math.round(metrics.netSentTotalGb * 1000) / 1000,
    bwDailyRecvGb:     Math.round(metrics.netRecvTotalGb * 1000) / 1000,
    bwMonthlySentGb:   Math.round(metrics.netSentTotalGb * 1000) / 1000,
    bwMonthlyRecvGb:   Math.round(metrics.netRecvTotalGb * 1000) / 1000,
    latitude:          metrics.latitude,
    longitude:         metrics.longitude,
    timestamp:         Date.now(),
    cpuModel:          metrics.cpuModel,
    machineBrand:      metrics.machineBrand,
    machineModel:      metrics.machineModel,
    diskType:          metrics.diskType,
    ramType:           'LPDDR',
    ramSpeedMhz:       0,
    gpuModel:          '',
  };

  // Accumule dans la file locale
  const queue = await pushToBatchQueue(reading);

  const base: Omit<HeartbeatResult, 'ok' | 'queued' | 'error' | 'commands'> = {
    sentAt:      Date.now(),
    networkType: metrics.networkType,
    battery:     metrics.batteryPercent,
    disk:        metrics.diskPercent,
    cpu:         metrics.cpuPercent,
    ram:         metrics.ramPercent,
    netSentMbps: metrics.netSentMbps,
    netRecvMbps: metrics.netRecvMbps,
    procNet:     metrics.procNetAvailable,
    queueLen:    queue.length,
  };

  // Envoie quand on a atteint la taille du batch
  if (queue.length < BATCH_SIZE) {
    return { ...base, ok: true, queued: true, commands: [] };
  }

  try {
    const res = await fetch(`${settings.serverUrl}/monitor/batch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(queue),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    await clearBatchQueue();

    let commands: ServerCommand[] = [];
    try {
      const json = await res.json() as { commands?: ServerCommand[] };
      commands = json.commands ?? [];
    } catch { }

    return { ...base, ok: true, queued: false, queueLen: 0, commands };
  } catch (e: any) {
    // En cas d'erreur réseau on garde la file pour le prochain essai
    return {
      ...base,
      ok:       false,
      queued:   false,
      error:    e?.message ?? 'Erreur réseau',
      commands: [],
    };
  }
}

export async function ackCommand(serverUrl: string, machineId: string, commandId: number): Promise<void> {
  try {
    await fetch(`${serverUrl}/monitor/command-ack`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ machineId, commandId }),
    });
  } catch { }
}

export async function selfUninstall(serverUrl: string, machineId: string): Promise<void> {
  try {
    await fetch(`${serverUrl}/monitor/machines/${machineId}/self`, {
      method: 'DELETE',
    });
  } catch { }
}
