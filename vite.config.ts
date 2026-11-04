import { defineConfig } from 'vite';

// In dev the lobby server (npm run server) runs beside Vite; send it the API and live updates.
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
