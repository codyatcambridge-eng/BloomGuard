import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'bet.goodcreation.miracleworker',
  appName: 'Miracle Worker',
  webDir: 'dist',
  server: {
    // Capacitor matches hostnames here; this is the equivalent of allowing https://www.youtube.com/*
    allowNavigation: [
      'youtube.com',
      '*.youtube.com',
      'youtu.be',
      '*.youtu.be',
      'ytimg.com',
      '*.ytimg.com',
      'googlevideo.com',
      '*.googlevideo.com',
    ],
  },
  plugins: {
    InAppBrowser: {
      // Plugin configuration
    },
  },
};

export default config;
