import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.b8261d4e5f8d406f98bb2e235eb6b0ad',
  appName: 'GoodCreation Browser',
  webDir: 'dist',
  server: {
    url: 'https://b8261d4e-5f8d-406f-98bb-2e235eb6b0ad.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  plugins: {
    InAppBrowser: {
      // Plugin configuration
    },
  },
};

export default config;
