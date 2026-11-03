// Stall watchdog for task runs: if a run shows no output AND no file changes in its
// worktree for `idleMs`, it is stopped as "stalled" so the task can be handed on.
// (Some CLIs print nothing until they finish, so file activity counts too.)

function createWatchdog({ idleMs, probe, onStall, now = Date.now, every = null, setTimer = setInterval, clearTimer = clearInterval }) {
  let last = now();
  let fp = null;
  let stalled = false;
  let busy = false;
  const tick = async () => {
    if (stalled || busy) return;
    busy = true;
    try {
      const f = await probe();
      if (f !== fp) { fp = f; last = now(); }
    } catch {}
    busy = false;
    if (!stalled && now() - last >= idleMs) {
      stalled = true;
      clearTimer(timer);
      onStall();
    }
  };
  const timer = idleMs > 0 ? setTimer(tick, every || Math.max(5000, Math.min(60000, Math.floor(idleMs / 4)))) : null;
  return {
    touch() { last = now(); },
    stop() { if (timer) clearTimer(timer); },
    tick,
    get stalled() { return stalled; },
  };
}

module.exports = { createWatchdog };
