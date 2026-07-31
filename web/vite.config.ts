import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En développement, le front tourne sur 5173 et l'API sur 3000.
    // Le proxy garde une origine unique côté navigateur : les cookies de
    // session fonctionnent donc exactement comme en production.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/mcp': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Le serveur Express sert ce dossier tel quel.
    emptyOutDir: true,
  },
});
