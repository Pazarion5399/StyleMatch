# Contributing to StyleMatch

Thanks for helping make StyleMatch the most accurate SFX / text-style tool for typesetters. Every improvement is welcome: code, new looks, test pages, bug reports, translations of the docs.

## Ways to help (most wanted first)
1. **Report results.** Run StyleMatch on a real page and open an issue with: the original text (crop), your result, the "StyleMatch notes" layer text (it includes a match score), your Photoshop version. Low scores are the most useful reports.
2. **Effect requests.** A look StyleMatch gets wrong or doesn't know yet: open an *Effect request* with a reference image.
3. **New looks.** Add a look to `src/fx_presets.js` (see below).
4. **Better detection.** Improve how the original is read (`src/fx_core.js`), e.g. Bevel & Emboss, textures, warped text.
5. **Arabic / RTL typesetting** checks and fixes.

## Rules
- Only your own work, or material whose licence allows redistribution (credit it in your pull request). No paid or pirated PSD/ASL files, fonts or textures.
- No full chapters or raw pages from published series in the repo. Small crops in issues are fine.
- Keep everything editable in Photoshop: layer styles, Smart Filters, masks. No flattening.
- Explain *why* in the notes text: every step StyleMatch adds has a short reason the user can read.

## How the code is laid out
| File | What it does |
|---|---|
| `src/fx_core.js` | Reads Raw vs Clean, finds the letters, fits the style (fill, strokes, glows, shadows, depth, split, dots...), match score |
| `src/sm_ps_main.js` | Photoshop side: builds the layer styles / layers with batchPlay |
| `src/fx_presets.js` | The looks library (`#preset name`) |
| `src/fx_kb.js`, `src/fx_ref.js` | Knowledge: filters, tools, and the "why" written into the notes |
| `src/build_sm.py` | Joins everything into `dist/StyleMatch.psjs` |

Build: `python3 src/build_sm.py 2.4` (then test `dist/StyleMatch.psjs` in Photoshop).

## Adding a look
In `src/fx_presets.js` add an entry to `PRESETS`:
- `family`, `look` (one line: what it looks like), `covers` (optional).
- `st`: the style. Sizes are per 100 px of text height. Fields: `fill` [r,g,b], `fillAcross` (gradient, helper `G('x'|'y', [[t,'#hex'],...])`), `strokes` [{size,color}], `inner` {size,color}, `innerGlow`, `glow` {mode,color,opacity,size,spread}, `shadow`, `moreShadows`, `extrude` {ux,uy,len,layers}, `split`.
- optional `bevel: BEVEL({...})`, `noise` (%), `gauss` (px), `note` (what to finish by hand).
- Add it to the list in `dist/StyleMatch Looks.jsx` too.
Test it on a few words and fonts, and attach a screenshot to the pull request.

## Pull requests
- One topic per pull request, with before/after screenshots and the Photoshop version you tested.
- Say if the match score changed on your test pages (from the notes layer).
- The maintainer tests and merges; please be patient.

## Licence
By contributing you agree your contribution is released under the MIT License of this project.
