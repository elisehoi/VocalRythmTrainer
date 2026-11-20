// Native bits: reminders and sharing files out of the app.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { t } from './i18n';

export const isNative = () => Capacitor.isNativePlatform();

const REMINDER_ID = 4242;

export async function setReminder(on: boolean, hour: number, minute: number): Promise<string | null> {
  if (!isNative()) return on ? t('remOnlyApp') : null;
  await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
  if (!on) return null;
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return t('remBlocked');
  await LocalNotifications.schedule({
    notifications: [{
      id: REMINDER_ID,
      title: t('remTitle'),
      body: t('remBody'),
      schedule: { on: { hour, minute }, allowWhileIdle: true },
    }],
  });
  return null;
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

// Save a file and open Android's share sheet (Drive, Files, email...). In a browser, download it.
export async function shareFile(name: string, blob: Blob, title: string) {
  if (!isNative()) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return;
  }
  const CHUNK = 3 * 1024 * 1024; // multiple of 3 so base64 chunks concatenate cleanly
  let first = true;
  for (let o = 0; o < blob.size; o += CHUNK) {
    const data = await blobToBase64(blob.slice(o, o + CHUNK));
    if (first) await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    else await Filesystem.appendFile({ path: name, data, directory: Directory.Cache });
    first = false;
  }
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
  await Share.share({ title, files: [uri] });
}
