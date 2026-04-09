import BackgroundActions from 'react-native-background-actions';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { sendHeartbeat } from './agent';

export const BACKGROUND_TASK = 'tanatech-heartbeat';
const LOOP_INTERVAL_MS = 10_000; // 10 secondes — monitoring temps réel

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const bgServiceTask = async (_taskData: any) => {
  while (BackgroundActions.isRunning()) {
    try { await sendHeartbeat(); } catch { /* silencieux */ }
    await sleep(LOOP_INTERVAL_MS);
  }
};

const BG_OPTIONS = {
  taskName:   'TanaTech Agent',
  taskTitle:  'TanaTech Monitor — actif',
  taskDesc:   'Surveillance système en cours — envoi toutes les 10 secondes.',
  taskIcon:   { name: 'ic_launcher', type: 'mipmap' },
  color:      '#00b894',
  linkingURI: 'tanatech-agent://',
  progressBar: undefined,
};

export async function startForegroundService(): Promise<void> {
  try {
    if (BackgroundActions.isRunning()) return;
    await BackgroundActions.start(bgServiceTask, BG_OPTIONS);
  } catch { /* ignore */ }
}

export async function stopForegroundService(): Promise<void> {
  try {
    if (BackgroundActions.isRunning()) await BackgroundActions.stop();
  } catch { /* ignore */ }
}

export function isForegroundServiceRunning(): boolean {
  return BackgroundActions.isRunning();
}

TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    await sendHeartbeat();
    await startForegroundService();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundTask(intervalMinutes = 1): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) return;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (isRegistered) await BackgroundFetch.unregisterTaskAsync(BACKGROUND_TASK);

    await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
      minimumInterval: intervalMinutes * 60,
      stopOnTerminate: false,
      startOnBoot:     true,
    });
  } catch { /* expo-go / first run */ }
}

export async function unregisterBackgroundTask(): Promise<void> {
  try {
    await stopForegroundService();
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (isRegistered) await BackgroundFetch.unregisterTaskAsync(BACKGROUND_TASK);
  } catch { /* ignore */ }
}
