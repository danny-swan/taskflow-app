/**
 * Тесты Wave A (PR-4 «Управление пространствами»): роль в текущем ws и гейт
 * редактирования.
 *
 *   useCurrentWorkspaceRole:
 *     • ws_local → owner (local-only, не привязан);
 *     • personal-ws → owner (владелец — сам пользователь);
 *     • shared-ws → роль из membership по (workspace_id, bound_user_id);
 *     • нет membership / ws не выбран → null.
 *   useCanEdit: viewer → false; owner/editor/null → true.
 *
 * db.ts мокаем — реальный SQLite не нужен; хуки читают только store-состояние.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../lib/db', () => ({
  initDb: vi.fn(async () => {}),
  get: vi.fn(),
  all: vi.fn(() => []),
  run: vi.fn(),
  exec: vi.fn(),
  save: vi.fn(async () => {}),
  isReady: vi.fn(() => true),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useStore, type Workspace, type WorkspaceMember } from './useStore';
import { useCurrentWorkspaceRole, useCanEdit, useIsViewer } from './workspaceScope';

const ws = (id: string, kind: string): Workspace =>
  ({ id, name: id, kind, owner_id: null, sort_order: 0 });

const member = (workspace_id: string, user_id: string, role: string): WorkspaceMember =>
  ({ id: `m_${workspace_id}_${user_id}`, workspace_id, user_id, role, invited_by: null, joined_at: null });

const UID = 'user-abc';

beforeEach(() => {
  useStore.setState({
    workspaces: [], workspaceMembers: [], currentWorkspaceId: null, boundUserId: UID,
  });
});

describe('useCurrentWorkspaceRole', () => {
  it('ws_local → owner', () => {
    useStore.setState({ currentWorkspaceId: 'ws_local' });
    expect(renderHook(() => useCurrentWorkspaceRole()).result.current).toBe('owner');
  });

  it('personal-ws → owner (без membership)', () => {
    useStore.setState({ workspaces: [ws('ws_p', 'personal')], currentWorkspaceId: 'ws_p' });
    expect(renderHook(() => useCurrentWorkspaceRole()).result.current).toBe('owner');
  });

  it('shared-ws → роль из membership (editor)', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [member('ws_s', UID, 'editor')],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useCurrentWorkspaceRole()).result.current).toBe('editor');
  });

  it('shared-ws → viewer', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [member('ws_s', UID, 'viewer')],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useCurrentWorkspaceRole()).result.current).toBe('viewer');
  });

  it('shared-ws без моего membership → null', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [member('ws_s', 'someone-else', 'owner')],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useCurrentWorkspaceRole()).result.current).toBeNull();
  });

  it('ws не выбран → null', () => {
    useStore.setState({ currentWorkspaceId: null });
    expect(renderHook(() => useCurrentWorkspaceRole()).result.current).toBeNull();
  });
});

describe('useCanEdit', () => {
  it('viewer → false', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [member('ws_s', UID, 'viewer')],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useCanEdit()).result.current).toBe(false);
  });

  it('editor → true', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [member('ws_s', UID, 'editor')],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useCanEdit()).result.current).toBe(true);
  });

  it('personal (owner) → true', () => {
    useStore.setState({ workspaces: [ws('ws_p', 'personal')], currentWorkspaceId: 'ws_p' });
    expect(renderHook(() => useCanEdit()).result.current).toBe(true);
  });

  it('роль неизвестна (null) → true (не блокируем до загрузки membership)', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useCanEdit()).result.current).toBe(true);
  });
});

describe('useIsViewer (Wave C PR-c-05)', () => {
  it('viewer → true', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [member('ws_s', UID, 'viewer')],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useIsViewer()).result.current).toBe(true);
  });

  it('editor → false', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [member('ws_s', UID, 'editor')],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useIsViewer()).result.current).toBe(false);
  });

  it('owner (personal) → false', () => {
    useStore.setState({ workspaces: [ws('ws_p', 'personal')], currentWorkspaceId: 'ws_p' });
    expect(renderHook(() => useIsViewer()).result.current).toBe(false);
  });

  it('роль неизвестна (null) → false', () => {
    useStore.setState({
      workspaces: [ws('ws_s', 'shared')],
      workspaceMembers: [],
      currentWorkspaceId: 'ws_s',
    });
    expect(renderHook(() => useIsViewer()).result.current).toBe(false);
  });
});
