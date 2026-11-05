// Chats in the window: pure helpers (tested in test/chats.test.mjs).
// A project's original team chat lives in that project's state (state.chat) and is never
// moved. Other chats live in their own files (electron/chats.cjs). The open chat's
// messages are shown as state.chat; these helpers keep the two from ever mixing.

export const isTeam = (id) => typeof id === 'string' && id.startsWith('team-');
export const teamChatId = (projectId) => `team-${projectId}`;

// Newest first; the open project's chats are not hidden, nothing is filtered out.
// Pinned first; within a group the owner's order (when set), then newest first (same as electron/chats.cjs).
export function sortChats(list = []) {
  return [...list].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    const ao = Number.isInteger(a.order), bo = Number.isInteger(b.order);
    if (ao && bo && a.order !== b.order) return a.order - b.order;
    if (ao !== bo) return ao ? -1 : 1;
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  });
}

// Move a chat one place up or down within its group (pinned or not); returns that group's new id order, or null.
export function moveInGroup(list = [], id, dir) {
  const sorted = sortChats(list);
  const me = sorted.find((c) => c.id === id);
  if (!me) return null;
  const group = sorted.filter((c) => Boolean(c.pinned) === Boolean(me.pinned)).map((c) => c.id);
  const i = group.indexOf(id), j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= group.length) return null;
  [group[i], group[j]] = [group[j], group[i]];
  return group;
}

// Drop a dragged chat before another one of the same group; returns the group's new id order, or null.
export function dropInGroup(list = [], dragId, beforeId) {
  const sorted = sortChats(list);
  const a = sorted.find((c) => c.id === dragId), b = sorted.find((c) => c.id === beforeId);
  if (!a || !b || a.id === b.id || Boolean(a.pinned) !== Boolean(b.pinned)) return null;
  const group = sorted.filter((c) => Boolean(c.pinned) === Boolean(a.pinned)).map((c) => c.id).filter((x) => x !== dragId);
  group.splice(group.indexOf(beforeId), 0, dragId);
  return group;
}

// A chat's automatic title: the first line of its first owner message, shortened.
export function autoTitle(text) {
  const line = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const t = line.replace(/\s+/g, ' ').replace(/^@\w+\s+/, '');
  if (!t) return '';
  return t.length > 48 ? `${t.slice(0, 47).replace(/\s+\S*$/, '')}…` : t;
}

// Which chat to open on start. Never switches projects by itself: a remembered chat
// linked to another project is not opened; the open project's team chat is.
export function pickOpenChat(list = [], remembered, activeProjectId) {
  const r = list.find((c) => c.id === remembered);
  if (r && (r.projectId === activeProjectId || (!r.projectId && !r.team))) return r.id;
  return teamChatId(activeProjectId);
}

// What opening a chat means: open it here, or switch to its project first.
export function openPlan(chat, activeProjectId) {
  if (!chat) return { kind: 'missing' };
  if (chat.projectId && chat.projectId !== activeProjectId) return { kind: 'switch', projectId: chat.projectId };
  return { kind: 'open' };
}

// What goes where on save. The project file always gets its own team chat (never another
// chat's messages); a separate chat's messages go only to that chat's file.
export function savePlan({ state, openChatId, teamChat, teamSessions }) {
  if (!openChatId || isTeam(openChatId)) return { project: state, chat: null };
  return {
    project: { ...state, chat: teamChat || [], chatSessions: teamSessions || {} },
    chat: { id: openChatId, messages: state.chat || [], sessions: state.chatSessions || {} },
  };
}

// Whether the AIs may edit files in this chat, and why not.
export function chatEditRule(chat, activeProjectId) {
  if (!chat) return { edit: false, unlinked: false, reason: 'no chat open' };
  if (!chat.projectId) return { edit: false, unlinked: true, reason: 'This chat is not linked to a project, so the team can talk but can’t edit files. Link a project from the chip above to let them work.' };
  if (chat.projectId !== activeProjectId) return { edit: false, unlinked: false, reason: 'This chat is linked to another project; open it to switch there first.' };
  return { edit: true, unlinked: false, reason: '' };
}
