// Not part of the app or CI: run by hand (node ci/measure-previews.mjs [sizes] [modes]).
// Measures how big an HTML live preview can get before the chat window stops responding.
// Pages are generated in memory (no disk): a real PNG (stored, uncompressed noise) embedded
// as base64 at the target size. Three ways to show it in a sandboxed iframe:
//   srcdoc  : the app's old way (escape + innerHTML with a srcdoc attribute in the window)
//   url     : the page streamed from a URL (what hearth-preview:// does from disk)
//   extract : the small page with the image as a separate URL (data: image extracted to a file)
import http from 'node:http';
import zlib from 'node:zlib';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const t = Buffer.from(type); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); }
function png(bytes) {
  const w = 1024; const h = Math.max(1, Math.floor(bytes / (w * 3 + 1)));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let i = 0; i < raw.length; i += 4096) raw[i] = (i * 2654435761) >>> 24; // sparse noise, still valid
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const pages = new Map();
function make(mb) {
  const target = mb * 1048576;
  const img = png(Math.floor(target * 0.74));
  const b64 = img.toString('base64');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${mb} MB</title></head><body><h1>Preview ${mb} MB</h1><img id="im" style="max-width:100%" src="data:image/png;base64,${b64}"><script>document.getElementById('im').decode().then(()=>parent.postMessage({done:1},'*')).catch(()=>parent.postMessage({done:1,err:1},'*'))</script></body></html>`;
  const small = `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Preview ${mb} MB</h1><img id="im" style="max-width:100%" src="/img/${mb}.png"><script>document.getElementById('im').decode().then(()=>parent.postMessage({done:1},'*')).catch(()=>parent.postMessage({done:1,err:1},'*'))</script></body></html>`;
  pages.set(`/page/${mb}.html`, { type: 'text/html', body: Buffer.from(html) });
  pages.set(`/small/${mb}.html`, { type: 'text/html', body: Buffer.from(small) });
  pages.set(`/img/${mb}.png`, { type: 'image/png', body: img });
  const row = '<tr><td>Row</td><td class="n">12345</td><td><b>bold</b> text and <i>more</i></td><td><a href="#x">link</a></td></tr>';
  const dom = `<!doctype html><html><head><meta charset="utf-8"></head><body><table>${row.repeat(Math.floor(target / row.length))}</table><script>requestAnimationFrame(()=>parent.postMessage({done:1},'*'))</script></body></html>`;
  pages.set(`/dom/${mb}.html`, { type: 'text/html', body: Buffer.from(dom) });
  return html.length;
}
const shell = `<!doctype html><html><body><div id="host" style="width:800px;height:600px"></div><script>
window.gaps=[];let last=performance.now();(function tick(t){window.gaps.push(t-last);last=t;requestAnimationFrame(tick)})(last);
window.addEventListener('message',(e)=>{if(e.data&&e.data.done)window.doneAt=performance.now()});
const esc=(s)=>String(s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
</script></body></html>`;
pages.set('/', { type: 'text/html', body: Buffer.from(shell) });
const server = http.createServer((q, r) => { const p = pages.get(q.url); if (!p) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.type, 'content-length': p.body.length }); r.end(p.body); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const sizes = (process.argv[2] || '1,2,5,10,25,50').split(',').map(Number);
const browser = await chromium.launch();
const out = [];
for (const mb of sizes) {
  make(mb);
  for (const mode of (process.argv[3]||'srcdoc,url,extract').split(',')) {
    const page = await browser.newPage();
    await page.goto(base + '/');
    let html = null;
    if (mode === 'srcdoc') html = (await (await fetch(`${base}/page/${mb}.html`)).text());
    const r = await page.evaluate(async ({ mode, html, mb }) => {
      window.gaps = []; window.doneAt = 0;
      await new Promise((ok) => requestAnimationFrame(() => ok()));
      const t0 = performance.now();
      const host = document.getElementById('host');
      if (mode === 'srcdoc') host.innerHTML = `<iframe sandbox="allow-scripts" style="width:100%;height:100%" srcdoc="${esc(html)}"></iframe>`;
      else host.innerHTML = `<iframe sandbox="allow-scripts" style="width:100%;height:100%" src="${mode === 'url' ? `/page/${mb}.html` : mode === 'dom' ? `/dom/${mb}.html` : `/small/${mb}.html`}"></iframe>`;
      const block = performance.now() - t0; // synchronous main-thread time in the chat window
      const deadline = t0 + 60000;
      while (!window.doneAt && performance.now() < deadline) await new Promise((ok) => setTimeout(ok, 20));
      const gaps = window.gaps.slice(1);
      return { block: Math.round(block), shown: window.doneAt ? Math.round(window.doneAt - t0) : null, worstFrame: Math.round(Math.max(0, ...gaps)), mem: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576) };
    }, { mode, html, mb });
    out.push({ mb, mode, ...r });
    console.log(JSON.stringify({ mb, mode, ...r }));
    await page.close();
  }
  for (const k of [...pages.keys()]) if (k !== '/') pages.delete(k);
}
await browser.close();
server.close();
