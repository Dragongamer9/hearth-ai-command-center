// Project guard: one project's board, chats, permissions and Next version can never be
// saved into another project's file, and no AI ever runs in a workspace that belongs to
// another project's repository.
//
// How the bug happened (1.3.0 and earlier): the window saved its whole state with
// `state:save`, which carried no project id. On a project switch the main process swapped
// the state file first and the window reloaded after. Any save that reached the main
// process after the swap (a chat round still answering, a timer, the lead waker, a job
// poll) wrote the old project's state into the new project's file. And the team chat's
// workspace ids all live in one shared folder (workspaces/CHAT…), which was reused by id
// without checking which repository it belongs to.
//
// The fix: the window is bound to the project it loaded; state is stamped with that id;
// the main process refuses a save (and guarded actions) from a window bound to another
// project, and the chat workspace is chosen by the main process and verified per repo.
const fs = require('node:fs');
const path = require('node:path');

// Same id the window always derived from the project folder (so existing workspaces keep working).
function chatWorkspaceId(projectDir, n = 0) {
  let h = 0;
  for (const c of String(projectDir || '') + (n ? `#${n}` : '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `CHAT${h.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`;
}

// The window's binding. bind() when the window loads a project's state; unbind() the
// moment the main process switches projects (before the window reloads).
function createBinding() {
  let bound = null; // project id the window loaded
  let active = null; // project id whose file the store points at
  return {
    setActive(id) { active = id; bound = null; },
    bind(id) { bound = id; },
    active: () => active,
    bound: () => bound,
    // A save is accepted only from a window bound to the active project, stamped with it.
    checkSave(state) {
      if (!active) return { ok: false, reason: 'no active project' };
      if (bound !== active) return { ok: false, reason: 'the window still shows the previous project (it is reloading)' };
      const id = state && typeof state === 'object' ? state.projectId : undefined;
      if (id !== active) return { ok: false, reason: `this state belongs to project ${id || 'unknown'}, not the open project ${active}` };
      return { ok: true };
    },
    // Actions (runs, merges, releases, tags, workspaces) only from a window bound to the active project.
    checkAction(projectId) {
      if (!active || bound !== active) return { ok: false, reason: 'the window still shows the previous project (it is reloading)' };
      if (projectId !== undefined && projectId !== null && projectId !== active) return { ok: false, reason: 'that belongs to a different project than the open one' };
      return { ok: true };
    },
  };
}

// Pick the team chat's workspace for a project: its usual CHAT id when that folder is
// missing or belongs to this repo; otherwise a fresh id (the wrong one is never used).
async function chooseChatWorkspace({ project, root, belongsTo }) {
  let notice = null;
  for (let n = 0; n < 5; n++) {
    const id = chatWorkspaceId(project, n);
    const dir = path.join(root, id);
    if (!fs.existsSync(path.join(dir, '.git'))) return { id, notice };
    if (await belongsTo(dir, project)) return { id, notice };
    notice = `The chat workspace ${id} belongs to another project's repository, so it was not used. This chat uses its own workspace instead.`;
  }
  throw new Error('No free chat workspace id for this project.');
}

// Signs that a project's saved state was copied from another project (look only; never repaired here).
function detectCrossCopy(active, others) {
  const out = [];
  const ids = (s) => new Set((s?.tasks || []).map((t) => t && t.id).filter(Boolean));
  const mine = ids(active.state);
  for (const o of others) {
    if (!o.state) continue;
    const theirs = ids(o.state);
    const shared = [...mine].filter((x) => theirs.has(x));
    const smaller = Math.min(mine.size, theirs.size);
    if (shared.length >= 2 && smaller && shared.length / smaller >= 0.8) {
      out.push({ kind: 'tasks', other: o.id, otherName: o.name, shared: shared.length, text: `${active.name} holds ${shared.length} of the same tasks as ${o.name} (it looks copied from it).` });
    }
    const ws = active.state?.chatWs?.id;
    if (ws && o.dir && ws === chatWorkspaceId(o.dir) && ws !== chatWorkspaceId(active.dir)) {
      out.push({ kind: 'chatWs', other: o.id, otherName: o.name, text: `${active.name}'s saved chat workspace (${ws}) is ${o.name}'s.` });
    }
  }
  return out;
}

// The state:load / state:save handlers (electron/main.cjs uses exactly these).
// load() binds the window to the open project and stamps the state with its id;
// save() writes only state stamped with the open project's id from a bound window.
function stateIpc({ binding, read, write }) {
  return {
    load() {
      const st = read();
      const id = binding.active();
      binding.bind(id);
      return st ? { ...st, projectId: id } : { projectId: id, empty: true };
    },
    save(state) {
      const g = binding.checkSave(state);
      if (!g.ok) return { ok: false, refused: 'project', message: `Not saved: ${g.reason}.` };
      return write(state);
    },
  };
}

module.exports = { chatWorkspaceId, createBinding, chooseChatWorkspace, detectCrossCopy, stateIpc };
