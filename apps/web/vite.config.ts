import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs on :3000 in development; the dev server proxies /v1 so cookies and CORS are not involved.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/v1': 'http://localhost:3000', '/health': 'http://localhost:3000' } },
  build: { target: 'es2022', sourcemap: true },
});
