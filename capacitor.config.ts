import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.whoageier.app',
  appName: 'Whoa Geier',
  webDir: 'dist/family-command-center/browser',
  server: {
    androidScheme: 'https'
  }
};

export default config;
