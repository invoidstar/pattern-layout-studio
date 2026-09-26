# Pattern Layout Studio

Browser-side pattern-part extraction, no-scale layout editing and PNG export.

## V1.2

The current pipeline is:

**Upload → robust background model → text exclusion → morphology cleanup → contour smoothing → MaxRects packing → manual repair → PNG + DPI**

### Text exclusion

- conservative geometry-based text-line detection is enabled by default
- protected large parts are never removed just because their edges fragment
- optional lazy Chinese/English OCR enhancement is available
- OCR failure automatically falls back to geometry filtering

### Smooth edges

- closing + opening morphology
- tiny-island removal
- small-hole filling
- 8-connected components
- outer and internal contour tracing
- Chaikin smoothing
- supersampled antialiased alpha
- even-odd rendering preserves real internal holes

### Manual repair

- select / multi-select
- drag
- lock / unlock
- brush restore
- eraser
- merge
- split disconnected regions
- delete
- Undo / Redo
- Ctrl/Shift multi-select
- Ctrl+Z / Ctrl+Shift+Z

### Debug / acceptance diagnostics

The app can show:

- raw mask
- post-text-filter mask
- smoothed mask
- detected text boxes
- text count
- removed-island count
- filled-hole count
- final part count
- MaxRects strategy and utilization

### Layout and export

- 3500×3500
- 2970×2100
- no part resizing in packing/editor/export
- configurable DPI
- PNG `pHYs` metadata
- overflow validation before export

## Live site

https://invoidstar.github.io/pattern-layout-studio/

## Real-image acceptance

V1.2 was checked against five real user-supplied pattern images. The most important cases include:

- a 2048×2048 sheet with **3 Chinese annotation lines**: 3 text regions removed, 11/11 intended parts retained
- a gray-background JPEG with severe edge fragmentation: **87 raw components → 11 intended final parts**
- white PNG/JPEG pattern sheets where text filtering remains inactive and intended part counts are preserved

The private source images are not committed to this public repository.

Detailed documents:

- [V1.2 implementation](docs/V1.2_IMPLEMENTATION.md)
- [V1.2 acceptance](docs/V1.2_ACCEPTANCE.md)
- [V1.1 acceptance](docs/V1.1_ACCEPTANCE.md)

## Privacy

Image processing happens in the browser. Uploaded pattern images are not sent to this repository. Optional OCR downloads its OCR runtime/language data only when the OCR enhancement switch is enabled.
