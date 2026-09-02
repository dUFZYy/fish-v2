import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.fishingadventure.app',
  appName: 'A Silly Fishing Game',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'never', preferredContentMode: 'mobile' },
  plugins: {
    SplashScreen: { launchAutoHide: true, backgroundColor: '#1c4f6b' },
    StatusBar: { style: 'DARK', overlaysWebView: true },
  },
};

export default config;
