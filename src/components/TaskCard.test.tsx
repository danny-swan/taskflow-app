/**
 * TaskCard — регрессионный тест на «Вернуть в работу» (fix v1.0.2).
 *
 * Баг: клик по кнопке «Вернуть в работу» у задачи в статусе «Выполнено»
 * открывал диалог выбора статуса. После выбора статуса и подтверждения
 * задача не переходила в новый статус — вместо этого всплывал попап
 * детального редактирования (onOpenModal) со старым снимком задачи, и
 * сохранение затирало статус обратно в «Выполнено».
 *
 * Причина: ConfirmDialog рендерится через createPortal, но React прокидывает
 * события по дереву компонентов, поэтому клик по кнопке «Вернуть» всплывал в
 * onClick корневой карточки и вызывал onOpenModal. Фикс — гасить onCardClick,
 * пока открыт диалог reopen.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Status, Tag, Task } from '../store/useStore';

const updateTask = vi.fn();
const softDeleteTask = vi.fn();
const pushToast = vi.fn();

const statuses: Status[] = [
  { id: 1, name: 'В работе', color: '#3b82f6', behavior: 'middle', sort_order: 1, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0 },
  { id: 2, name: 'Запланировано', color: '#a855f7', behavior: 'top', sort_order: 0, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0 },
  { id: 3, name: 'Выполнено', color: '#10b981', behavior: 'archive', sort_order: 2, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0 },
];
const tags: Tag[] = [];

const state: Record<string, unknown> = {
  language: 'ru',
  statuses,
  tags,
  overdueMode: 'calendar',
  updateTask,
  softDeleteTask,
  pushToast,
};

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

// Импортируем ПОСЛЕ vi.mock, чтобы TaskCard получил замоканный useStore.
import { TaskCard } from './TaskCard';

function makeDoneTask(): Task {
  return {
    id: 42,
    title: 'Починить кран',
    comment: '',
    tag_id: null,
    status_id: 3, // «Выполнено» (archive)
    start_date: null,
    deadline: null,
    finish_date: '2026-07-01',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    sort_order: 0,
    archived: 0,
  };
}

describe('TaskCard — возврат в работу из «Выполнено»', () => {
  beforeEach(() => {
    updateTask.mockClear();
    softDeleteTask.mockClear();
    pushToast.mockClear();
  });

  it('после подтверждения меняет статус и НЕ открывает попап редактирования', async () => {
    const user = userEvent.setup();
    const onOpenModal = vi.fn();
    render(<TaskCard task={makeDoneTask()} onOpenModal={onOpenModal} />);

    // Открываем диалог выбора статуса.
    await user.click(screen.getByRole('button', { name: 'Вернуть в работу' }));

    expect(screen.getByText('Выберите статус:')).toBeInTheDocument();
    // Подтверждаем предвыбранный статус (по умолчанию — первый 'middle').
    await user.click(screen.getByRole('button', { name: 'Вернуть' }));

    // Статус применён на предвыбранный 'middle' (id=1).
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith(42, { status_id: 1 });
    // Ключ регрессии: попап детального редактирования НЕ открылся.
    expect(onOpenModal).not.toHaveBeenCalled();
    // Диалог закрылся.
    expect(screen.queryByText('Выберите статус:')).toBeNull();
  });

  it('применяет статус, выбранный радио-кнопкой в диалоге', async () => {
    const user = userEvent.setup();
    const onOpenModal = vi.fn();
    render(<TaskCard task={makeDoneTask()} onOpenModal={onOpenModal} />);

    await user.click(screen.getByRole('button', { name: 'Вернуть в работу' }));

    // Выбираем «Запланировано» (id=2) вместо предвыбранного.
    await user.click(screen.getByLabelText('Запланировано'));
    await user.click(screen.getByRole('button', { name: 'Вернуть' }));

    expect(updateTask).toHaveBeenCalledWith(42, { status_id: 2 });
    expect(onOpenModal).not.toHaveBeenCalled();
  });

  it('отмена диалога не меняет статус и не открывает попап', async () => {
    const user = userEvent.setup();
    const onOpenModal = vi.fn();
    render(<TaskCard task={makeDoneTask()} onOpenModal={onOpenModal} />);

    await user.click(screen.getByRole('button', { name: 'Вернуть в работу' }));
    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(updateTask).not.toHaveBeenCalled();
    expect(onOpenModal).not.toHaveBeenCalled();
    expect(screen.queryByText('Выберите статус:')).toBeNull();
  });
});
