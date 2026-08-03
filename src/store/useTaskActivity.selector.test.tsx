// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Регресс Bug A: селектор useTaskActivity для пустого журнала ДОЛЖЕН возвращать
// стабильную ссылку между рендерами. Инлайн-литерал `[]` создавал новую ссылку
// на каждый снимок zustand/useSyncExternalStore → бесконечный ре-рендер
// ("Maximum update depth exceeded") → AppErrorBoundary при открытии задачи в
// shared-пространстве (там рендерится TaskActivityLog).
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../lib/db', () => ({ all: () => [] }));
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { useTaskActivity } from './useTaskActivityStore';

describe('Bug A: стабильность ссылки пустого журнала', () => {
  it('taskUuid=null → records стабильны между рендерами (нет петли)', () => {
    const { result, rerender } = renderHook(() => useTaskActivity(null));
    const first = result.current.records;
    rerender();
    rerender();
    expect(result.current.records).toBe(first); // та же ссылка, не новый []
    expect(first).toEqual([]);
  });

  it('taskUuid без записей → records стабильны между рендерами', () => {
    const { result, rerender } = renderHook(() => useTaskActivity('task-без-записей'));
    const first = result.current.records;
    rerender();
    rerender();
    expect(result.current.records).toBe(first);
    expect(first).toEqual([]);
  });
});
