/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.10 — Модалка Политики конфиденциальности.
 * — Контакт: GitHub Issues (email пока не выделен)
 * — Пояснение про хеш пароля (bcrypt, необратим)
 * Текст встроен inline (RU + EN) — независимость от сети и файлов.
 * Оригинал: PRIVACY.md в корне репо.
 */
import { X } from 'lucide-react';
import { useStore } from '../store/useStore';

interface Props {
  onClose: () => void;
}

export function PrivacyModal({ onClose }: Props) {
  const lang = useStore(s => s.language);
  const isRu = lang === 'ru';

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-[640px] max-h-[85vh] bg-surface border border-border rounded-xl shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-soft">
          <h2 className="font-display font-semibold text-[15px]">
            {isRu ? 'Политика конфиденциальности' : 'Privacy Policy'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surface-alt text-muted"
            aria-label={isRu ? 'Закрыть' : 'Close'}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto text-[13px] leading-relaxed space-y-3">
          {isRu ? (
            <>
              <p className="text-muted text-[12px]">Дата вступления в силу: 3 июля 2026</p>

              <h3 className="font-semibold text-[14px] mt-2">Какие данные мы собираем</h3>

              <p><strong>Данные аккаунта:</strong> email, хеш пароля, дата регистрации и последнего входа.</p>

              <p className="text-[12px] text-muted border-l-2 border-border-soft pl-3">
                <strong>Что такое хеш пароля?</strong> Мы <strong>не храним ваш пароль</strong> — ни разработчик, ни Supabase его не видят. Сохраняется только «хеш» — односторонняя криптографическая свёртка (bcrypt), из которой восстановить пароль математически невозможно. При входе введённый вами пароль хешируется тем же алгоритмом и сравнивается со сохранённым значением.
              </p>

              <p><strong>Телеметрия:</strong> тип события (регистрация, вход, старт приложения, создание/удаление задачи — <em>без содержимого</em>), версия приложения, операционная система, время события.</p>

              <p><strong>Что мы НЕ собираем:</strong> содержимое задач (названия, описания, теги, дедлайны) хранится <strong>только локально</strong> в SQLite на вашем устройстве и никогда не отправляется на сервер. Никакой рекламной аналитики, никакой передачи третьим лицам.</p>

              <h3 className="font-semibold text-[14px] mt-3">Где хранятся данные</h3>
              <p>Локальные задачи — SQLite на вашем устройстве. Аккаунт и телеметрия — Supabase (Postgres), регион Frankfurt (EU).</p>

              <h3 className="font-semibold text-[14px] mt-3">Ваши права</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Получить копию данных — откройте issue на <a href="https://github.com/danny-swan/taskflow-app/issues" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">GitHub</a> с меткой <code>data-request</code></li>
                <li>Удалить аккаунт — Настройки → Аккаунт → «Удалить аккаунт». Все данные удаляются немедленно.</li>
                <li>Отозвать согласие — удаление аккаунта эквивалентно отзыву</li>
              </ul>

              <h3 className="font-semibold text-[14px] mt-3">Зачем нам эти данные</h3>
              <p>Аутентификация невозможна без email. Телеметрия помогает понимать, сколько людей пользуется приложением, на каких версиях/OS, и решать, какие функции разрабатывать.</p>

              <p className="text-muted text-[12px] mt-4">
                Полный текст: <a href="https://github.com/danny-swan/taskflow-app/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">github.com/danny-swan/taskflow-app/blob/main/PRIVACY.md</a>
              </p>
            </>
          ) : (
            <>
              <p className="text-muted text-[12px]">Effective date: July 3, 2026</p>

              <h3 className="font-semibold text-[14px] mt-2">What data we collect</h3>

              <p><strong>Account data:</strong> email, password hash, registration and last login dates.</p>

              <p className="text-[12px] text-muted border-l-2 border-border-soft pl-3">
                <strong>What is a password hash?</strong> We <strong>do not store your password</strong> — neither the developer nor Supabase can see it. Only a «hash» is stored — a one-way cryptographic digest (bcrypt) from which the password cannot mathematically be recovered. On login, the password you enter is hashed with the same algorithm and compared to the stored value.
              </p>

              <p><strong>Telemetry:</strong> event type (signup, login, app start, task created/deleted — <em>without content</em>), app version, operating system, event timestamp.</p>

              <p><strong>What we do NOT collect:</strong> task content (titles, descriptions, tags, deadlines) is stored <strong>only locally</strong> in SQLite on your device and never leaves it. No advertising analytics, no third-party sharing.</p>

              <h3 className="font-semibold text-[14px] mt-3">Where data is stored</h3>
              <p>Local tasks — SQLite on your device. Account and telemetry — Supabase (Postgres), Frankfurt (EU) region.</p>

              <h3 className="font-semibold text-[14px] mt-3">Your rights</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Get a copy of your data — open an issue on <a href="https://github.com/danny-swan/taskflow-app/issues" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">GitHub</a> with the <code>data-request</code> label</li>
                <li>Delete account — Settings → Account → «Delete account». All data deleted immediately.</li>
                <li>Withdraw consent — account deletion is equivalent</li>
              </ul>

              <h3 className="font-semibold text-[14px] mt-3">Why we need this data</h3>
              <p>Authentication requires email. Telemetry helps understand how many people use the app, on which versions/OSes, and decide what features to build.</p>

              <p className="text-muted text-[12px] mt-4">
                Full text: <a href="https://github.com/danny-swan/taskflow-app/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">github.com/danny-swan/taskflow-app/blob/main/PRIVACY.md</a>
              </p>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border-soft flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[13px] rounded-md text-white font-medium hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            {isRu ? 'Закрыть' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
