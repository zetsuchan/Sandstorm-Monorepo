import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      __APP_BUILD__: JSON.stringify(new Date().toISOString()),
    },
    server: {
      port: Number(env.VITE_DASHBOARD_PORT || 5173),
    },
  };
});
