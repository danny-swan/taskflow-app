// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * seedData.ts — единый источник правды для сид-справочников (статусы/теги).
 *
 * Раньше список статусов/тегов жил внутри db.ts и дублировался в seed() (web) и
 * tauriSeed() (Tauri). Любое расхождение приводило к разным справочникам на
 * разных платформах, что критично для sync (набор статусов должен быть
 * идентичным). Теперь список вынесен в отдельный модуль, чтобы им могли
 * пользоваться и db.ts (первичный сев personal-ws + ensureSeededIfEmpty), и
 * store.createWorkspace (сев дефолтных статусов при создании ЛЮБОГО нового ws) —
 * без дублирования литералов.
 *
 * ВАЖНО (docs/architecture): часть логики завязана на ИМЕНА «Приостановлено»
 * (hold-периоды) и «Выполнено»/«Удалено» (архивация). Имена и behavior менять
 * нельзя — они являются эталоном.
 */

export interface SeedStatus {
  name: string; color: string; behavior: string;
  hidden: 0 | 1; default_collapsed: 0 | 1; is_technical: 0 | 1;
}

/** Эталонные 7 статусов (sort_order = индекс). Все сеются с is_seed=1. */
export const SEED_STATUSES: SeedStatus[] = [
  { name: 'Важно',          color: '#EE204D', behavior: 'top',     hidden: 0, default_collapsed: 0, is_technical: 0 },
  { name: 'Сегодня',        color: '#C44A8E', behavior: 'top',     hidden: 0, default_collapsed: 0, is_technical: 0 },
  { name: 'В процессе',     color: '#D98F2B', behavior: 'middle',  hidden: 0, default_collapsed: 0, is_technical: 0 },
  { name: 'Взять в работу', color: '#FFFFFF', behavior: 'middle',  hidden: 0, default_collapsed: 0, is_technical: 0 },
  { name: 'Приостановлено', color: '#7A7974', behavior: 'bottom',  hidden: 0, default_collapsed: 0, is_technical: 0 },
  { name: 'Выполнено',      color: '#437A22', behavior: 'archive', hidden: 0, default_collapsed: 1, is_technical: 0 },
  // Технический статус «Удалено» — скрыт в списке задач и в топбаре (hidden=1).
  { name: 'Удалено',        color: '#5A5957', behavior: 'archive', hidden: 1, default_collapsed: 0, is_technical: 1 },
];

export const SEED_TAGS: { name: string; color: string }[] = [
  { name: 'OPS', color: '#5B7FB8' },
  { name: 'DEV', color: '#437A22' },
  { name: 'MTG', color: '#C44A8E' },
  { name: 'LRN', color: '#D98F2B' },
  { name: 'PRS', color: '#7A7974' },
];
