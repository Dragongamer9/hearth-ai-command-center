// The sealed avatar page (electron/characters.cjs stagePage): draws one Live2D or VRM model and follows the moods
// the Command Center posts to it ({ mood, level }).
(async () => {
  const cfg = JSON.parse(document.getElementById('cfg').textContent);
  let stage = null;
  try { stage = await AvatarStage.create(document.getElementById('s'), { kind: cfg.kind, url: cfg.url, camera: 'full' }); } catch (e) { document.body.textContent = String(e && e.message || e); return; }
  window.addEventListener('message', (ev) => { const d = ev.data || {}; try { if (d.mood) stage.setMood(d.mood); stage.speak(Number(d.level) || 0); } catch (_) {} });
})();
