import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          sql: ['sql.js'],
          // v0.8.12: xlsx и papaparse нужны только в Settings (импорт/экспорт) —
          // выносим в отдельные чанки, чтобы не входили в main bundle
          xlsx: ['xlsx'],
          papaparse: ['papaparse'],
        },
      },
    },
  },
});
