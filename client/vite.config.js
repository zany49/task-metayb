import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser calls /api/... on the same origin; Vite forwards those requests to the API server.
// That avoids CORS setup in development. Change API_URL if your API runs elsewhere.
const apiTarget = process.env.API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': apiTarget },
  },
  preview: {
    port: 4173,
    proxy: { '/api': apiTarget },
  },
});
