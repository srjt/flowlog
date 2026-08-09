# Cue-image reference-conditioning spike (wayfinder #12)

Does feeding a correct **reference** to `gemini-3-pro-image` hold a real BJJ
position, vs today's text-only generation? See map #10, decisions Q1–Q9.

## How to run
1. Drop reference files into `spike/refs/` (git-ignored). One **diagram** and,
   if comparing, one **photo** per position. Name them clearly, e.g.
   `de-la-riva.diagram.png`, `de-la-riva.photo.jpg`.
2. Copy `manifest.example.json` → `manifest.json` and fill in, per position:
   `name` (canonical position), `cue` (a representative coaching cue to
   emphasize), and the `refs` paths.
3. Run:
   ```bash
   GEMINI_API_KEY=... node scripts/spikeRefConditioning.ts
   ```
4. Eyeball `spike/out/` — for each position you get `__text-only.png` (baseline),
   `__diagram.png`, and/or `__photo.png`. The black-belt panel judges each
   against the **never-misleading (b) floor** (and notes which reach expert (a)).
