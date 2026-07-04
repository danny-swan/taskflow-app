import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

// v0.9.23: source maps в проде включаем только если у нас есть Sentry
// auth token (в CI приходит из secrets.SENTRY_AUTH_TOKEN). Без токена
// нет смысла генерировать sourcemaps — они утекут в артефакт и увеличат
// размер релиза.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const enableSentryUpload = Boolean(sentryAuthToken && sentryOrg && sentryProject);

export default defineConfig({
  plugins: [
    react(),
    // Плагин должен быть последним, чтобы видеть финальный bundle.
    // Если токена нет (dev или PR-билд) — плагин не добавляется вовсе.
    ...(enableSentryUpload
      ? [
          sentryVitePlugin({
            authToken: sentryAuthToken,
            org: sentryOrg,
            project: sentryProject,
            release: { name: `taskflow@${pkg.version}` },
            sourcemaps: {
              // Только client-bundle из dist. src-tauri (Rust) не трогаем.
              assets: './dist/**',
            },
            // EU-регион Sentry (Frankfurt) — совпадает с Supabase.
            url: 'https://sentry.io/',
            telemetry: false,
          }),
        ]
      : []),
  ],
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
    // Source maps нужны Sentry для расшифровки минифицированного стека.
    // Генерируем их всегда в проде; загружаем в Sentry только если есть токен.
    sourcemap: true,
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
