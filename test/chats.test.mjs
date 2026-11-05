// Part B, window side: chats never bleed into each other or into another project's file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTeam, teamChatId, sortChats, autoTitle, pickOpenChat, openPlan, savePlan, chatEditRule } from '../src/chats.mjs';


test('save plan: the project file only ever gets its own team chat; a chat\'s messages go to its own file', () => {
  const team = [{ id: 't1', who: 'owner', text: 'team' }];
  const state = { projectId: 'default', tasks: [], audit: [], chat: [{ id: 'n1', who: 'owner', text: 'new chat' }], chatSessions: { 'CHATX:anthropic': { sessionId: 'new' } } };
  const p = savePlan({ state, openChatId: 'c0123456789', teamChat: team, teamSessions: { 'CHATX:anthropic': { sessionId: 'team' } } });
  assert.deepEqual(p.project.chat, team);
  assert.equal(p.project.chatSessions['CHATX:anthropic'].sessionId, 'team');
  assert.equal(p.project.projectId, 'default');
  assert.deepEqual(p.chat.messages, state.chat);
  assert.equal(p.chat.sessions['CHATX:anthropic'].sessionId, 'new');
  // Team chat open: the state is saved as it always was.
  const q = savePlan({ state, openChatId: 'team-default', teamChat: null });
  assert.equal(q.project, state);
  assert.equal(q.chat, null);
  assert.equal(savePlan({ state, openChatId: null }).chat, null);
});

test('start-up never switches projects by itself', () => {
  const list = [{ id: 'team-a', team: true, projectId: 'a' }, { id: 'team-b', team: true, projectId: 'b' }, { id: 'c1', projectId: 'b' }, { id: 'c2', projectId: null }];
  assert.equal(pickOpenChat(list, 'c1', 'a'), 'team-a', "a remembered chat of another project isn't opened");
  assert.equal(pickOpenChat(list, 'c1', 'b'), 'c1');
  assert.equal(pickOpenChat(list, 'c2', 'a'), 'c2', 'an unlinked chat opens anywhere');
  assert.equal(pickOpenChat(list, 'gone', 'b'), 'team-b');
});

test('opening a chat linked to another project switches projects first (the guarded switch)', () => {
  assert.deepEqual(openPlan({ id: 'c1', projectId: 'b' }, 'a'), { kind: 'switch', projectId: 'b' });
  assert.deepEqual(openPlan({ id: 'c1', projectId: 'a' }, 'a'), { kind: 'open' });
  assert.deepEqual(openPlan({ id: 'c2', projectId: null }, 'a'), { kind: 'open' });
});

test('a chat with no project can talk but never edits files, and says so', () => {
  const r = chatEditRule({ id: 'c2', projectId: null }, 'a');
  assert.equal(r.edit, false);
  assert.equal(r.unlinked, true);
  assert.match(r.reason, /can talk but can’t edit files/);
  assert.equal(chatEditRule({ id: 'c1', projectId: 'a' }, 'a').edit, true);
  assert.equal(chatEditRule({ id: 'c1', projectId: 'b' }, 'a').edit, false);
});

test('titles from the first message; newest first', () => {
  assert.equal(autoTitle('  Fix the boot menu on the Ally\nmore details'), 'Fix the boot menu on the Ally');
  assert.equal(autoTitle('@claude can you look at this'), 'can you look at this');
  assert.ok(autoTitle('x'.repeat(200)).length <= 48);
  assert.equal(autoTitle(''), '');
  assert.deepEqual(sortChats([{ id: 'a', updatedAt: '2026-11-01' }, { id: 'b', updatedAt: '2026-11-04' }]).map((c) => c.id), ['b', 'a']);
  assert.ok(isTeam(teamChatId('default')));
  assert.ok(!isTeam('c0123456789'));
});

