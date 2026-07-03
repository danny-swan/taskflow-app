import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
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
