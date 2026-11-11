// 3.4: the cores for the AIs added in 3.3/3.4, drawn as line art (our own abstract shapes, no company logos).
// Each returns the inside of an <svg viewBox="0 0 100 100">; colours come from the core's --c (currentColor).
const h = 50;
const r = 40;
const f = (n) => Number(n.toFixed(1));
const P = (cx, cy, rr, n, rot = 0) => Array.from({ length: n }, (_, i) => `${f(cx + rr * Math.cos(rot + (2 * Math.PI * i) / n))},${f(cy + rr * Math.sin(rot + (2 * Math.PI * i) / n))}`).join(' ');
const st = 'stroke="currentColor" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
const fill = 'fill="currentColor"';
const range = (n) => Array.from({ length: n }, (_, i) => i);
const star = (n, inner, rot = -Math.PI / 2) => range(n * 2).map((i) => { const k = i % 2 ? inner : 1; const a = rot + (Math.PI * i) / n; return `${f(h + r * k * Math.cos(a))},${f(h + r * k * Math.sin(a))}`; }).join(' ');

export const SHAPES = {
  prism: () => `<polygon points="${P(h, h, r, 3, -Math.PI / 2)}" ${st}/><polygon points="${P(h, h, r * 0.45, 3, Math.PI / 2)}" ${st} opacity=".7"/>`,
  twin: () => `<circle cx="${h - 14}" cy="${h}" r="22" ${st}/><circle cx="${h + 14}" cy="${h}" r="22" ${st}/><circle cx="${h - 14}" cy="${h}" r="4" ${fill}/><circle cx="${h + 14}" cy="${h}" r="4" ${fill}/>`,
  blueprint: () => `<rect x="10" y="10" width="80" height="80" ${st} opacity=".6"/>${[1, 2, 3].map((i) => `<line x1="10" y1="${10 + i * 20}" x2="90" y2="${10 + i * 20}" ${st} opacity=".3"/>`).join('')}<path d="M26,70 L50,26 L74,70" ${st}/>`,
  crescent: () => `<path d="M58,10 A40,40 0 1 0 58,90 A28,28 0 1 1 58,10" ${st}/>`,
  pair: () => `<rect x="10" y="26" width="36" height="48" rx="5" ${st}/><rect x="54" y="26" width="36" height="48" rx="5" ${st}/><line x1="46" y1="50" x2="54" y2="50" ${st}/>`,
  brackets: () => `<path d="M34,10 L10,50 L34,90" ${st}/><path d="M66,10 L90,50 L66,90" ${st}/><line x1="56" y1="22" x2="44" y2="78" ${st}/>`,
  vee: () => `<path d="M10,30 L50,74 L90,30" ${st}/><path d="M26,30 L50,56 L74,30" ${st} opacity=".6"/>`,
  steps: () => `<polyline points="10,90 10,62 38,62 38,38 62,38 62,10 90,10" ${st}/>`,
  shards: () => `<polygon points="50,10 62,50 50,58" ${st}/><polygon points="90,58 54,62 62,42" ${st}/><polygon points="10,66 46,54 42,90" ${st}/>`,
  fan: () => `${range(5).map((i) => { const a = Math.PI * (0.15 + (0.7 * i) / 4); return `<line x1="50" y1="88" x2="${f(50 + 40 * Math.cos(a))}" y2="${f(88 - 64 * Math.sin(a))}" ${st}/>`; }).join('')}<path d="M12,54 A40,40 0 0 1 88,54" ${st} opacity=".5"/>`,
  bolt: () => `<polygon points="58,10 30,54 50,54 42,90 70,46 50,46" ${st}/>`,
  plus: () => `<line x1="50" y1="10" x2="50" y2="90" ${st}/><line x1="10" y1="50" x2="90" y2="50" ${st}/><circle cx="50" cy="50" r="22" ${st} opacity=".6"/>`,
  gear: () => `<polygon points="${star(8, 0.75, 0)}" ${st}/><circle cx="50" cy="50" r="12" ${st}/>`,
  tunnel: () => [1, 0.7, 0.45, 0.22].map((k) => `<rect x="${f(50 - 40 * k)}" y="${f(50 - 40 * k)}" width="${f(80 * k)}" height="${f(80 * k)}" ${st} opacity="${k}"/>`).join(''),
  routes: () => `<path d="M10,50 C42,14 58,86 90,50" ${st}/><path d="M10,50 C42,86 58,14 90,50" ${st}/><circle cx="10" cy="50" r="5" ${fill}/><circle cx="90" cy="50" r="5" ${fill}/>`,
  lattice: () => `${[-1, 0, 1].flatMap((x) => [-1, 0, 1].map((y) => `<circle cx="${50 + x * 24}" cy="${50 + y * 24}" r="4" ${fill}/>`)).join('')}<polygon points="${P(h, h, 34, 4, Math.PI / 4)}" ${st} opacity=".5"/>`,
  petals: () => [0, 72, 144, 216, 288].map((a) => `<ellipse cx="50" cy="30" rx="11" ry="20" ${st} transform="rotate(${a} 50 50)"/>`).join(''),
  scroll: () => `<path d="M10,26 L78,26 A12,12 0 0 1 78,50 L22,50 A12,12 0 0 0 22,74 L90,74" ${st}/>`,
  pulse: () => `<polyline points="10,50 34,50 42,18 54,82 64,50 90,50" ${st}/><circle cx="50" cy="50" r="40" ${st} opacity=".35"/>`,
  star4: () => `<polygon points="${star(4, 0.4)}" ${st}/>`,
  eye2: () => `<path d="M10,50 Q50,6 90,50 Q50,94 10,50" ${st}/><path d="M42,36 A14,14 0 1 0 64,50" ${st}/>`,
  speed: () => `${range(4).map((i) => `<line x1="${10 + i * 6}" y1="${26 + i * 16}" x2="82" y2="${26 + i * 16}" ${st} opacity="${1 - i * 0.2}"/>`).join('')}<polygon points="58,10 90,50 58,90" ${st} opacity=".5"/>`,
  wafer: () => `<circle cx="50" cy="50" r="40" ${st}/>${[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => `<rect x="${26 + i * 17}" y="${26 + j * 17}" width="13" height="13" ${st} opacity=".7"/>`)).join('')}`,
  frame: () => `<rect x="10" y="20" width="80" height="60" rx="5" ${st}/><line x1="10" y1="36" x2="90" y2="36" ${st}/><rect x="22" y="46" width="24" height="24" ${st} opacity=".6"/>`,
  cloudring: () => `<path d="M10,62 A16,16 0 0 1 34,38 A20,20 0 0 1 70,38 A16,16 0 0 1 90,62 Z" ${st}/><circle cx="50" cy="54" r="8" ${st}/>`,
  comet: () => `<circle cx="68" cy="32" r="12" ${st}/><line x1="58" y1="42" x2="10" y2="90" ${st}/><line x1="68" y1="46" x2="30" y2="90" ${st} opacity=".5"/><line x1="54" y1="32" x2="10" y2="70" ${st} opacity=".5"/>`,
  heartgrid: () => [0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map((j) => `<rect x="${10 + i * 20}" y="${10 + j * 20}" width="16" height="16" rx="3" ${st} opacity="${(i + j) % 2 ? 0.4 : 1}"/>`)).join(''),
  blocks: () => `<rect x="10" y="10" width="36" height="36" rx="3" ${st}/><rect x="54" y="10" width="36" height="36" rx="3" ${st} opacity=".5"/><rect x="10" y="54" width="36" height="36" rx="3" ${st} opacity=".5"/><rect x="54" y="54" width="36" height="36" rx="3" ${st}/>`,
  zig: () => `<polyline points="10,26 38,74 62,26 90,74" ${st}/>`,
  flame: () => `<path d="M50,10 C90,42 74,90 50,90 C26,90 10,42 50,10 Z" ${st}/><path d="M50,50 C66,62 58,82 50,82" ${st} opacity=".6"/>`,
  flow: () => range(3).map((i) => `<path d="M10,${30 + i * 20} C38,${10 + i * 20} 62,${50 + i * 20} 90,${30 + i * 20}" ${st} opacity="${1 - i * 0.25}"/>`).join(''),
  dunes: () => range(3).map((i) => `<path d="M10,${70 - i * 16} Q50,${30 - i * 16} 90,${70 - i * 16}" ${st} opacity="${1 - i * 0.3}"/>`).join(''),
  glyph: () => `<path d="M22,90 L50,10 L78,90 M34,58 L66,58" ${st}/><circle cx="50" cy="50" r="40" ${st} opacity=".35"/>`,
  compass: () => `<circle cx="50" cy="50" r="40" ${st}/><polygon points="50,18 58,50 50,82 42,50" ${st}/>`,
  reel: () => `<circle cx="50" cy="50" r="40" ${st}/>${range(5).map((i) => { const a = (i * 2 * Math.PI) / 5; return `<circle cx="${f(50 + 22 * Math.cos(a))}" cy="${f(50 + 22 * Math.sin(a))}" r="8" ${st}/>`; }).join('')}`,
  halo: () => `<ellipse cx="50" cy="30" rx="40" ry="11" ${st}/><circle cx="50" cy="58" r="20" ${st}/>`,
  film: () => `<rect x="26" y="10" width="48" height="80" ${st}/>${range(4).map((i) => `<rect x="30" y="${16 + i * 18}" width="8" height="8" ${fill} opacity=".7"/><rect x="62" y="${16 + i * 18}" width="8" height="8" ${fill} opacity=".7"/>`).join('')}`,
  spark: () => range(8).map((i) => { const a = (i * Math.PI) / 4; const k = i % 2 ? 0.55 : 1; return `<line x1="50" y1="50" x2="${f(50 + 40 * k * Math.cos(a))}" y2="${f(50 + 40 * k * Math.sin(a))}" ${st}/>`; }).join(''),
  quad: () => [0, 1, 2, 3].map((i) => `<rect x="${10 + (i % 2) * 42}" y="${10 + Math.floor(i / 2) * 42}" width="38" height="38" ${st} opacity="${[1, 0.6, 0.6, 1][i]}"/>`).join(''),
  rings3: () => `<circle cx="34" cy="40" r="20" ${st}/><circle cx="66" cy="40" r="20" ${st} opacity=".7"/><circle cx="50" cy="66" r="20" ${st} opacity=".5"/>`,
  keyhole: () => `<circle cx="50" cy="38" r="20" ${st}/><path d="M42,54 L36,90 L64,90 L58,54" ${st}/>`,
  hive: () => [[50, 26], [30, 50], [70, 50], [50, 74]].map(([x, y]) => `<polygon points="${P(x, y, 14, 6)}" ${st}/>`).join(''),
};

export function svgCore(shape) {
  const fn = SHAPES[shape];
  return fn ? `<svg class="lc" viewBox="0 0 100 100" aria-hidden="true">${fn()}</svg>` : '';
}
