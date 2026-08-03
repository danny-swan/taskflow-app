// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// InvitePinBadge — визуальный индикатор непринятых приглашений (Wave C, PR-c-02).
//
// Презентационный «unread pin» поверх иконки/пункта меню:
//   count === 0 → null (ничего не рендерим);
//   count === 1 → красная точка без числа (классический unread-dot);
//   count >= 2  → красный бейдж с числом, при count > 99 показываем «99+».
// Позиционируется absolute в top-right угол — родитель должен быть relative.
// Данные (myPending.length) прокидываются пропсом: стор компонент не читает,
// чтобы оставаться чисто презентационным и переиспользуемым.
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';

interface InvitePinBadgeProps {
  /** Число pending-инвайтов текущего пользователя. */
  count: number;
  /** Доп. классы позиционирования/отступов поверх дефолтного top-right. */
  className?: string;
}

export function InvitePinBadge({ count, className }: InvitePinBadgeProps) {
  const lang = useStore(s => s.language);
  if (count <= 0) return null;

  const aria = tr(lang, 'ws_invite_pin_aria').replace('{count}', String(count));
  const pos = 'absolute -top-1 -right-1 ' + (className ?? '');

  // count === 1 → точка без числа; смысл несёт aria-label.
  if (count === 1) {
    return (
      <span
        role="status"
        aria-label={aria}
        data-testid="invite-pin"
        className={pos + ' w-2 h-2 rounded-full bg-[var(--error,#c33)] ring-2 ring-[var(--surface)]'}
      />
    );
  }

  return (
    <span
      role="status"
      aria-label={aria}
      data-testid="invite-pin"
      className={
        pos +
        ' min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--error,#c33)] text-white ' +
        'text-[9px] font-semibold flex items-center justify-center tabular ring-2 ring-[var(--surface)]'
      }
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
