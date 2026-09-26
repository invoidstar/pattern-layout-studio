# Pattern Layout Studio

Browser-side pattern-part segmentation, no-scale packing and PNG export.

## V1.1

The current V1.1 pipeline is:

**Upload → robust background estimation → Segmentation V2 → MaxRects Packing V2 → canvas editing → PNG + DPI metadata**

### Segmentation V2

- full-border median background estimation instead of four-corner averaging
- adaptive background tolerance
- JPEG/background-noise tolerance
- fast 3×3 majority cleanup
- 8-connected component extraction
- original source pixels are cropped, never resized

### Packing V2

- multi-strategy MaxRects Best-Short-Side-Fit
- tries area / max-side / height / width orderings
- explicit overflow reporting
- configurable inter-part gap
- part width and height remain unchanged

### Canvas editor

- select and drag
- lock / unlock
- delete
- automatic re-layout
- 3500×3500 and 2970×2100 canvases
- overflow validation before export

### Export

- PNG
- configurable DPI (300 by default)
- PNG `pHYs` metadata
- 1:1 part pixel dimensions through the full export path

## Live site

https://invoidstar.github.io/pattern-layout-studio/

## Acceptance

V1.1 was checked with three real user-supplied pattern-layout images covering:

- white PNG background
- JPEG compression
- foreground touching an image edge
- non-white gray background

Detected major-part counts were **10/10**, **10/10**, and **11/11** respectively. All three cases packed with zero overflow on both target canvas sizes.

See [docs/V1.1_ACCEPTANCE.md](docs/V1.1_ACCEPTANCE.md) for the detailed acceptance table.

## Privacy

Image processing runs in the browser. The real images used for acceptance are not committed to this public repository.
