# Third-party notices and rights boundary

The Apache License 2.0 in [`LICENSE`](LICENSE) covers original source code and
documentation authored for SEE-ME SEE-U by p-to-q. It does not relicense
separable third-party material, generated assets, fonts, demo-derived data,
sound recordings, brand assets, the work's name, or the artwork as a staged
installation. Those materials retain the terms described below.

This inventory is part of the distribution. More specific notices beside an
asset take precedence for that asset.

## Opening ring: Viscose-carousel

`packages/app/src/choose/ring/` adapts the mathematical and timing approach of
[Viscose-carousel](https://github.com/Yousuf-developer/Viscose-carousel) by
Yousuf Soomro. The implementation was rewritten from GLSL/React to TSL/plain
TypeScript; no image or font from the upstream `public/` directory is used.
The method remains subject to the upstream MIT notice:

```text
MIT License

Copyright (c) 2026 Yousuf Soomro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The upstream analysis and exact differences are in
[`docs/35-VISCOSE.md`](docs/35-VISCOSE.md).

## Real-machine geometry

Six species use geometry derived from publicly licensed robot-description
repositories. Each source has its own BSD-3-Clause variant, BSD-3-Clause, MIT,
or Apache-2.0 terms. The original licence texts are retained under
[`assets/parts/licenses/`](assets/parts/licenses/); the pinned commits,
copyright holders, per-part source files, modifications, and non-endorsement
notices are in [`assets/parts/ATTRIBUTION.md`](assets/parts/ATTRIBUTION.md).

The geometry was re-oriented, normalised, decimated, and stripped of original
materials for this installation. No source company or institution is
affiliated with, sponsors, or endorses SEE-ME SEE-U.

## Hyper3D / Rodin outputs

Generated files under `assets/parts/*.glb` and `assets/refs/*/_anchor.png` were
created with Hyper3D Rodin and normalised by this repository's asset pipeline.
They are not relicensed by Apache-2.0. Reuse depends on the applicable Hyper3D
terms, the account plan used to generate them, rights in the inputs, and any
third-party rights in the outputs.

## Fonts

- `assets/fonts/LXGWWenKai/` is a web subset of LXGW WenKai Lite and remains
  under the SIL Open Font License 1.1. The exact licence and subset record are
  in [`assets/fonts/LXGWWenKai/OFL.txt`](assets/fonts/LXGWWenKai/OFL.txt) and
  [`assets/fonts/LXGWWenKai/NOTICE.md`](assets/fonts/LXGWWenKai/NOTICE.md).
- `assets/fonts/ZKMSerendipity/` contains ZKMSerendipity webfonts. Rights belong
  to ZKM | Center for Art and Media Karlsruhe and its designers. The project
  holder reports permission for this non-commercial artwork, but the
  repository does not contain evidence that independently establishes the
  scope of public Git or webfont redistribution. Apache-2.0 grants no rights
  to these files. Forks and redistributors must obtain permission or remove
  the directory; the system-font fallback remains functional. See
  [`assets/fonts/ZKMSerendipity/NOTICE.md`](assets/fonts/ZKMSerendipity/NOTICE.md).

Wordmark outlines and exported brand graphics derived from ZKMSerendipity
letterforms are part of the same separate rights review; they are not granted
under Apache-2.0.

## Demo pose data

`assets/demo/pose-jumpingjacks.json` and `assets/demo/pose-walkturn.json` are
MediaPipe coordinate derivatives of Wikimedia Commons videos by Taco Fleur,
licensed under CC BY-SA 4.0. Attribution, source URLs, transformation details,
and quality measurements are in [`assets/demo/SOURCES.md`](assets/demo/SOURCES.md).
They remain under CC BY-SA 4.0 and are not covered by Apache-2.0.

`assets/demo/pose-synthetic.json` is project-generated test data and is covered
by Apache-2.0.

## Sound

The nine processed `.webm` contact sounds under `assets/sound/` come from
Freesound recordings offered under CC0 1.0. Authors, source URLs,
transformations, dates, uses, and captured licence evidence are recorded in
[`assets/sound/README.md`](assets/sound/README.md) and `assets/sound/licenses/`.
They are not represented as original p-to-q recordings.

## Software dependencies

The browser and asset-pipeline distributions include or depend on third-party
software. Direct dependencies locked for this release include:

| Software | Licence | Copyright / source |
|---|---|---|
| three.js | MIT | Copyright © 2010–2026 three.js authors |
| meshoptimizer | MIT | Copyright © 2016–2026 Arseny Kapoulkine |
| glTF-Transform | MIT | Copyright © 2024 Don McCurdy |
| MediaPipe Tasks Vision | Apache-2.0 | Google LLC / Google AI Edge |
| Vite | MIT | Vite contributors |
| TypeScript | Apache-2.0 | Microsoft Corporation |

The package manifests and lockfile are the source of truth for current
versions. Their upstream licence files remain authoritative. For the MIT works
listed above, the applicable permission and warranty text is:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Artwork, brand, and staging

The name SEE-ME SEE-U, brand assets under `assets/brand/`, interaction and
experience design considered as an artwork, exhibition texts, and permission
to stage or present the installation are not granted merely by the source-code
licence. Apache-2.0 also grants no trademark rights beyond its Section 6.

This boundary is not an additional restriction on Apache-licensed code. It
identifies separable material and rights that the code licence does not cover.
