# Pattern Layout Studio

Browser-side pattern-part extraction, source tracing, no-scale layout editing, automatic pagination and PNG/ZIP export.

## V1.4

The current pipeline is:

**Upload → text exclusion → edge cleanup → host-aware grouping → source trace → multi-page MaxRects → page editing → PNG / ZIP export**

### Source Trace

V1.4 makes every converted part traceable back to the original uploaded image.

- each automatically extracted part stores its exact original crop coordinates
- selecting a converted part highlights its source region on the original image
- clicking a source-region box selects the corresponding converted part
- the source panel shows x / y / width / height in original-image pixels
- all parts on the current layout page can be seen as lightweight source boxes
- the selected part receives a stronger source highlight
- manually merged parts preserve multiple source regions
- split parts inherit or refine their source coordinates when mapping is unambiguous

This creates a direct visual relationship:

> converted part ↔ original image region

### V1.4 workspace

The main editor is now a three-column workstation:

1. **Source Trace** — original image, source boxes, source coordinates and debug views
2. **Canvas Editor** — page navigation and manual layout/repair tools
3. **Parts / Quality** — current-page part list and processing diagnostics

On narrower screens the layout automatically collapses to two columns and then one column.

### Host-aware part grouping

The V1.3.1 over-segmentation fix remains enabled.

Split strength:

- **Conservative (default)** — keep internal artwork with its host part
- **Standard**
- **Fine**

### Automatic multi-page layout

- MaxRects page 1
- remaining parts continue to page 2, page 3, ...
- near-canvas-size parts can receive dedicated pages
- only parts physically larger than the target canvas are truly unplaceable
- no resize is used to solve packing

Targets:

- 3500×3500
- 2970×2100

### Editing

- page navigation
- select / multi-select
- drag
- lock / unlock
- brush restore
- eraser
- merge
- split
- delete
- Undo / Redo
- re-pagination

### Export

- current page PNG
- all pages ZIP
- configurable DPI
- PNG `pHYs` metadata
- no-scale dimensions throughout export

### Quality pipeline retained

- geometry text filtering
- optional Chinese/English OCR
- robust background model
- morphology
- contour smoothing
- multiple foreground islands per logical part
- internal-hole preservation
- antialiased alpha

## Live site

https://invoidstar.github.io/pattern-layout-studio/

## Documentation

- [V1.4 implementation](docs/V1.4_IMPLEMENTATION.md)
- [V1.4 acceptance](docs/V1.4_ACCEPTANCE.md)
- [V1.3.1 acceptance](docs/V1.3.1_ACCEPTANCE.md)
- [V1.3 implementation](docs/V1.3_IMPLEMENTATION.md)
- [V1.3 acceptance](docs/V1.3_ACCEPTANCE.md)

## Privacy

Image processing happens in the browser. Uploaded pattern images are not committed to this repository. Optional OCR downloads OCR runtime/language data only when enabled.
