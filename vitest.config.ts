import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // v0.9.35-dev.6.1: фиктивные env для unit-тестов (import.meta.env.VITE_*).
    // Реальные значения в .env.local (в gitignore).
    'import.meta.env.VITE_ADMIN_EMAILS': JSON.stringify('admin@example.test'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://test.supabase.test'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // src/** — фронт; supabase/functions/**/*.test.ts — чистые серверные
    // helper-модули (_shared/*), которые тестируются без Deno-рантайма.
    // Deno-тесты edge-функций живут в файлах `test.ts` (не *.test.ts) и сюда
    // не попадают — их гоняет `deno test` отдельно.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'supabase/functions/**/*.{test,spec}.ts'],
    // Tauri APIs и другие браузерные штуки, которых нет в jsdom
    // мокаются в setup.ts / отдельных тестах.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Пока стартовый минимум — покрытие поднимем в следующих релизах
      // по мере роста числа тестов.
      include: ['src/lib/**', 'src/store/**'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/test/**',
      ],
    },
  },
});
