import { readFileSync, writeFileSync } from 'node:fs';
import { renderDiagramSvg, PAGE_CSS } from './issue18/renderer.ts';
// General base-only pose viewer (no overlay) — for eyeballing authored skeletons.
const pose = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const empty = { base: pose.id, annotations: [] as unknown[] };
const f = renderDiagramSvg(pose, empty, 0, { skin: 'fleshed' });
const s = renderDiagramSvg(pose, empty, 1, { skin: 'stickman' });
const html = `<!doctype html><meta charset="utf8"><style>${PAGE_CSS}
 body{padding:16px} .fd svg{width:520px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
 .r{display:flex;gap:22px;flex-wrap:wrap}.c b{font-size:12px;color:var(--muted)}</style>
 <div class="fd"><h2>${pose.label || pose.id}</h2><div class="r">
 <div class="c"><b>FLESHED</b><br>${f}</div><div class="c"><b>STICKMAN</b><br>${s}</div></div></div>`;
writeFileSync('spike/pose-check.html', html);
console.log('wrote spike/pose-check.html');
