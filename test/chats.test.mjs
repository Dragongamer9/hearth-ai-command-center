// Part B, window side: chats never bleed into each other or into another project's file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTeam, teamChatId, sortChats, autoTitle, pickOpenChat, openPlan, savePlan, chatEditRule } from '../src/chats.mjs';

const ui = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

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
  assert.match(ui, /function requestSwitch\(projectId\)[\s\S]*dataset\.ops = 'switch'/, 'uses the project switcher\'s own switch');
});

test('a chat with no project can talk but never edits files, and says so', () => {
  const r = chatEditRule({ id: 'c2', projectId: null }, 'a');
  assert.equal(r.edit, false);
  assert.equal(r.unlinked, true);
  assert.match(r.reason, /can talk but can’t edit files/);
  assert.equal(chatEditRule({ id: 'c1', projectId: 'a' }, 'a').edit, true);
  assert.equal(chatEditRule({ id: 'c1', projectId: 'b' }, 'a').edit, false);
  assert.match(ui, /chatRule\(\)\.unlinked \? \{ mode: 'read', unlinked: true \}/, 'runs in an unlinked chat are read-only');
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

test('the window never trusts a saved chat workspace: the main process picks and verifies it every round', () => {
  assert.doesNotMatch(ui, /state\.chatWs\s*=/, 'state.chatWs is never assigned (saved data is left as it is)');
  assert.match(ui, /api\.ensureChatWorkspace\(state\.projectId\)/);
  assert.match(ui, /r\.projectId === state\.projectId/);
  assert.match(ui, /if \(ui\.switching\) return saveChain;/, 'nothing is saved while switching');
  assert.match(ui, /state\.projectId = saved\?\.projectId/, 'state is stamped with the project it was loaded for');
});

test('the chats list is always reachable: sidebar list, narrowed-sidebar menu and a New chat button in the top bar', () => {
  const top = ui.slice(ui.indexOf('function topbar('), ui.indexOf('function boardList('));
  assert.match(top, /data-newchat/);
  assert.match(ui, /function chatsMenu\(\)/);
  assert.match(ui, /ui\.menu === 'chats' && ui\.sideCollapsed \? chatsMenu\(\)/);
  assert.match(ui, /data-ui="menu-chatproj"/, 'project chip at the top of a chat');
});
