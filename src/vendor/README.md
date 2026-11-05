# Vendored libraries (offline, no CDN)

Copied from the npm release tarballs (`npm pack <pkg>@<version>` in a scratch folder), never
installed into the repo or listed in package.json. Each folder keeps the library's own licence.

| Folder | Package | File(s) | Licence |
|---|---|---|---|
| three/ | three@0.170.0 | build/three.module.min.js | MIT |
| marked/ | marked@15.0.12 | lib/marked.esm.js | MIT |
| dompurify/ | dompurify@3.2.6 | dist/purify.es.mjs | Apache-2.0 or MPL-2.0 |
| katex/ | katex@0.16.22 | dist/katex.mjs, dist/fonts/*.woff2, dist/katex.min.css* | MIT |
| highlight/ | @highlightjs/cdn-assets@11.11.1 | es/highlight.min.js, styles/github-dark.min.css | BSD-3-Clause |
| mermaid/ | mermaid@11.6.0 | dist/mermaid.min.js | MIT |

\* katex.min.css: the `.woff` and `.ttf` fallbacks are removed from its `src:` lists (only the
`.woff2` fonts are shipped; Chromium uses woff2). Nothing else is changed.

Mermaid (2.6 MB) never runs in the app window: it is loaded only inside the sandboxed diagram
frame (`hearth-preview:`), so diagrams from AI output can't reach the app.
