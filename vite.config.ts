import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  optimizeDeps: { exclude: ['sql.js'] },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          sql: ['sql.js'],
        },
      },
    },
  },
});
