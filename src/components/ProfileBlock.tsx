/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v1.0.x — Блок кастомизации профиля внутри AccountSection (Settings).
 *
 * Показывает ПУБЛИЧНЫЙ ID (TF-XXXXXX) — его юзер сообщает другим (будущее
 * добавление в друзья). Внутренний profiles.id (=auth.users.id) намеренно НЕ
 * выводится. Ник, аватар (1..8) и «о себе» (видимый счётчик символов, ввод
 * режется по лимиту) сохраняются одной кнопкой через updateProfile —
 * public_user_id/id/email не отправляются; неизменяемость public_user_id
 * дополнительно держит серверный guard-триггер из миграции 0026.
 */
import { useEffect, useState } from 'react';
import { Copy, Save, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useProfile, NICKNAME_MAX, BIO_MAX } from '../lib/profile';
import { Avatar, AvatarPicker } from './Avatar';

export function ProfileBlock({ userId, isRu }: { userId: string; isRu: boolean }) {
  const t = (ru: string, en: string) => (isRu ? ru : en);
  const pushToast = useStore(s => s.pushToast);
  const { profile, loading, error, save } = useProfile(userId);

  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState(1);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Гидрация локальных полей из загруженного профиля (один раз).
  useEffect(() => {
    if (profile && !hydrated) {
      setNickname(profile.nickname ?? '');
      setBio(profile.bio ?? '');
      setAvatar(profile.avatar_variant ?? 1);
      setHydrated(true);
    }
  }, [profile, hydrated]);

  const handleCopyId = async () => {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(profile.public_user_id);
      pushToast(t('ID скопирован', 'ID copied'));
    } catch {
      pushToast(t('Не удалось скопировать', 'Copy failed'));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        nickname: nickname.trim() === '' ? null : nickname.trim(),
        bio: bio.trim() === '' ? null : bio.trim(),
        avatar_variant: avatar,
      });
      pushToast(t('Профиль сохранён', 'Profile saved'));
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка сохранения профиля', 'Failed to save profile'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !profile) {
    return (
      <div className="bg-surface-alt border border-border-soft rounded-lg p-4 text-[13px] text-muted">
        {t('Загрузка профиля…', 'Loading profile…')}
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="bg-surface-alt border border-border-soft rounded-lg p-4 text-[13px] text-muted">
        {t('Не удалось загрузить профиль', 'Failed to load profile')}
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="bg-surface-alt border border-border-soft rounded-lg p-4 space-y-4">
      <h4 className="font-display text-[14px] font-semibold">
        {t('Профиль', 'Profile')}
      </h4>

      {/* Публичный ID */}
      <div className="space-y-1">
        <div className="text-[12px] text-muted uppercase tracking-wide">
          {t('Ваш ID', 'Your ID')}
        </div>
        <div className="flex items-center gap-2">
          <code className="text-[14px] font-medium tracking-wide">{profile.public_user_id}</code>
          <button
            type="button"
            onClick={handleCopyId}
            className="inline-flex items-center gap-1 px-2 py-1 text-[12px] border border-border-soft rounded-md hover:bg-surface"
          >
            <Copy size={12} />
            {t('Скопировать', 'Copy')}
          </button>
        </div>
        <p className="text-[12px] text-muted">
          {t(
            'Этот ID можно сообщать другим — по нему вас найдут (например, чтобы добавить в друзья). Не меняется.',
            'Share this ID with others so they can find you (e.g. to add you as a friend). It never changes.',
          )}
        </p>
      </div>

      {/* Ник */}
      <div className="space-y-1">
        <label className="text-[12px] text-muted uppercase tracking-wide" htmlFor="profile-nickname">
          {t('Ник', 'Nickname')}
        </label>
        <input
          id="profile-nickname"
          type="text"
          value={nickname}
          maxLength={NICKNAME_MAX}
          onChange={e => setNickname(e.target.value.slice(0, NICKNAME_MAX))}
          placeholder={t('Как вас показывать', 'How to display you')}
          className="w-full px-3 py-2 text-[13px] bg-surface border border-border-soft rounded-md outline-none focus:border-accent"
        />
      </div>

      {/* Аватар */}
      <div className="space-y-2">
        <div className="text-[12px] text-muted uppercase tracking-wide">
          {t('Аватар', 'Avatar')}
        </div>
        <div className="flex items-center gap-3">
          <Avatar variant={avatar} size={48} />
          <AvatarPicker
            value={avatar}
            onChange={setAvatar}
            disabled={saving}
            label={t('Выбор аватара', 'Choose avatar')}
          />
        </div>
      </div>

      {/* О себе */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[12px] text-muted uppercase tracking-wide" htmlFor="profile-bio">
            {t('О себе', 'About')}
          </label>
          <span className="text-[12px] text-muted" aria-live="polite">
            {bio.length}/{BIO_MAX}
          </span>
        </div>
        <textarea
          id="profile-bio"
          value={bio}
          maxLength={BIO_MAX}
          rows={3}
          onChange={e => setBio(e.target.value.slice(0, BIO_MAX))}
          placeholder={t('Пара слов о себе', 'A few words about you')}
          className="w-full px-3 py-2 text-[13px] bg-surface border border-border-soft rounded-md outline-none focus:border-accent resize-none"
        />
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 text-[13px] border border-border-soft rounded-md hover:bg-surface disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {t('Сохранить профиль', 'Save profile')}
      </button>
    </div>
  );
}
