import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'io.github.elisehoi.vocalrhythm',
  appName: 'Rhythm Trainer',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { iconColor: '#B07CE8' }
  }
};
export default config;
