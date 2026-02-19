import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'bet.goodcreation.miracleworker',
  appName: 'Miracle Worker',
  webDir: 'dist',
  plugins: {
    SafeDriver: {},
    InAppBrowser: {
      // Plugin configuration
    },
  },
};

export default config;
