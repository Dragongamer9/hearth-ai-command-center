// Unified diff -> files and hunks for the "Show changes" viewer (pure, unit tested).
export function parseDiff(text) {
  const files = [];
  let f = null;
  let h = null;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      f = { path: m ? m[2] : line.slice(11), add: 0, del: 0, hunks: [], binary: false, status: 'modified' };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;
    if (line.startsWith('new file mode')) { f.status = 'added'; continue; }
    if (line.startsWith('deleted file mode')) { f.status = 'deleted'; continue; }
    if (line.startsWith('Binary files')) { f.binary = true; continue; }
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ') || line.startsWith('similarity') || line.startsWith('rename ')) continue;
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      h = { header: line, oldLine: m ? Number(m[1]) : 0, newLine: m ? Number(m[2]) : 0, lines: [] };
      f.hunks.push(h);
      continue;
    }
    if (!h) continue;
    const t = line[0];
    if (t === '+') { f.add++; h.lines.push({ t: '+', text: line.slice(1) }); }
    else if (t === '-') { f.del++; h.lines.push({ t: '-', text: line.slice(1) }); }
    else if (t === ' ') h.lines.push({ t: ' ', text: line.slice(1) });
    else if (line.startsWith('\\')) h.lines.push({ t: '\\', text: line });
  }
  // Line numbers for the viewer.
  for (const file of files) for (const hk of file.hunks) {
    let o = hk.oldLine;
    let n = hk.newLine;
    for (const l of hk.lines) {
      if (l.t === '+') { l.n = n++; } else if (l.t === '-') { l.o = o++; } else if (l.t === ' ') { l.o = o++; l.n = n++; }
    }
  }
  return files;
}
