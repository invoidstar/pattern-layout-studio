# Pattern Layout Studio

Browser-side pattern-part extraction, no-scale layout editing, automatic pagination and PNG export.

## V1.3

The current pipeline is:

**Upload → text exclusion → edge cleanup → smooth contour → automatic multi-page MaxRects → page editing → PNG / ZIP export**

### Automatic multi-page layout

V1.3 removes the old single-page overflow limitation.

- MaxRects packs page 1 first
- remaining parts automatically continue to page 2, page 3, ...
- a part that physically fits the target canvas can receive its own dedicated page
- only a part whose own width/height exceeds the target canvas is considered truly unplaceable
- no part is resized to make it fit

Supported targets:

- 3500×3500
- 2970×2100

### Page editor

- previous / next page navigation
- current page / total page indicator
- select / multi-select
- drag
- lock / unlock
- brush restore
- eraser
- merge
- split disconnected regions
- delete
- Undo / Redo
- complete re-pagination

### Export

- export current page as PNG
- export all pages as one ZIP
- ordered page filenames
- configurable DPI
- PNG `pHYs` metadata on every exported page
- 1:1 part pixel dimensions throughout packing and export

### V1.2 quality pipeline retained

- conservative geometry-based text-line detection
- optional lazy Chinese/English OCR enhancement
- robust dominant-border background model
- closing / opening morphology
- tiny-island removal
- small-hole filling
- outer and internal contour tracing
- Chaikin smoothing
- supersampled antialiased alpha
- even-odd rendering for internal holes

## Live site

https://invoidstar.github.io/pattern-layout-studio/

## Acceptance

V1.3 specifically addresses dense pattern sheets that previously produced `overflow` when every extracted part could not be packed onto one page.

The new rule is:

> Not fitting the current page creates another page. It is not an error.

A near-canvas-size part that fits physically but cannot satisfy the normal packing margin also receives a dedicated page instead of being reported as overflow.

Detailed documents:

- [V1.3 implementation](docs/V1.3_IMPLEMENTATION.md)
- [V1.3 acceptance](docs/V1.3_ACCEPTANCE.md)
- [V1.2 implementation](docs/V1.2_IMPLEMENTATION.md)
- [V1.2 acceptance](docs/V1.2_ACCEPTANCE.md)

## Privacy

Image processing happens in the browser. Uploaded pattern images are not committed to this repository. Optional OCR downloads OCR runtime/language data only when the OCR enhancement switch is enabled.
