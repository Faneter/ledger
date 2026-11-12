export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    androidScheme?: string;
    url?: string;
    cleartext?: boolean;
    [key: string]: unknown;
  };
  plugins?: Record<string, unknown>;
  [key: string]: unknown;
}

const config: CapacitorConfig = {
  appId: 'dev.faneter.geekledger',
  appName: 'GeekLedger',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
