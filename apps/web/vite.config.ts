import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser talks only to this server; /v1 and /health are passed on to the API, so phones on the
// office Wi-Fi need just one address and no CORS settings. API_TARGET overrides where the API runs.
const target = process.env.API_TARGET ?? 'http://localhost:3000';
const proxy = { '/v1': target, '/health': target };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // `npm run serve:web` serves the built app to phones on the same Wi-Fi (http://<laptop-ip>:5173).
  preview: { port: 5173, host: '0.0.0.0', strictPort: true, proxy },
  build: { target: 'es2022', sourcemap: true },
});
