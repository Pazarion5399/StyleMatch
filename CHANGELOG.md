# Changelog

## v2.6 (14 Nov 2026)
- **Heavy effects - scream / impact stack.** For a smeared or streaked raw text (or `#scream` in the layer name), a copy of the styled text goes UNDER it as a Smart Object with Motion Blur (angle and distance measured on the raw; Radial Zoom/Spin when the streaks come from a centre) + Add Noise + a small Wave shake, plus a faint shake ghost. Settings: `screamStack`, `screamFonts`, `screamBlurOpacity`, `screamNoise`, `screamShake`, `screamGhost`. `#noscream` skips it.
- **No layer renaming:** Background = original, the picture layer above = clean (a partial clean patch works). Watermark layers are never taken as the clean.

## v2.5
- **House outline rule** learned from 4,040 finished text layers: dark letters on a grey/tinted bubble get a 3 px white outline; light letters on dark art get a 3 px dark outline; system/neon fonts get a glow instead.
- **Plain texts stay plain:** black text in a white bubble with nothing on the raw gets no style.
- Per-series options: `houseStrokeWhiteBubble`, `houseStrokeFonts`.
- Fixed the "Clear Styles is not currently available" popup.
