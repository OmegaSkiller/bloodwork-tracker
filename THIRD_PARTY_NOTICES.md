# Third-party notices

The application source is licensed under MIT; dependencies retain their own licenses. This repository does not vendor node_modules, browser binaries, build output, reports, fonts, or stock imagery.

## Reviewed dependencies

The lockfile was inspected during publication preparation. Every locked package has license metadata. Direct runtime dependencies are MIT except `@e965/xlsx` (Apache-2.0). That package is an npm distribution of SheetJS Community Edition; its upstream code and license are included in the installed package. Playwright is Apache-2.0 and used only for development tests.

Transitive metadata also includes ISC, BSD variants, 0BSD and dual permissive expressions. Build-time Lightning CSS packages use MPL-2.0; caniuse-lite's browser data is CC-BY-4.0. Their source/data is unmodified and not copied into this repository. Keep installed dependency license/notice files when redistributing a packaged application. MIT for this repository does not relicense those components.

Relevant upstream licenses:
- [SheetJS Community Edition](https://git.sheetjs.com/sheetjs/sheetjs/src/branch/master/LICENSE)
- [Lightning CSS](https://github.com/parcel-bundler/lightningcss/blob/master/LICENSE)
- [caniuse-lite](https://github.com/browserslist/caniuse-lite/blob/main/LICENSE)
- [Playwright](https://github.com/microsoft/playwright/blob/main/LICENSE)

## Inline icons

Several paths in `src/components/Icons.jsx` are based on [Heroicons](https://github.com/tailwindlabs/heroicons), by Tailwind Labs. The following notice is retained for those paths. The favicon is a simple repository SVG drawing. Demo screenshots are rendered from this app using exclusively synthetic observations.

```text
MIT License

Copyright (c) Tailwind Labs, Inc.

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

The bundled assets contain no patient documents, external photographs, proprietary icon packs, or font files.
