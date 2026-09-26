# Pattern Layout Studio

Browser-side pattern-part extraction, exact shape masking, source tracing, cross-page layout editing, global page compaction and PNG/ZIP export.

## V1.6

The current pipeline is:

**Upload → text exclusion → morphology → exact shape extraction → host-aware grouping → source trace → global multi-page MaxRects → cross-page editing → repair tools → PNG / ZIP**

### Cross-page part transfer

V1.6 lets users explicitly control which page contains a part.

Select one or more parts, then use the Inspector to:

- move them to any existing page
- send them to the previous / next page
- create a new page for the selected parts

A transfer is validated before it is applied. The target page is repacked with:

**existing target-page parts + selected parts**

If every part cannot fit at 1:1 size, the move is rejected and the current layout is preserved.

After a successful transfer:

- the target page is repacked
- affected source pages are repacked
- empty pages are removed
- page indexes are compacted
- selection follows the moved parts

### Global page compaction

Automatic pagination now performs a second global optimization pass after the normal per-page MaxRects solve.

The optimizer:

1. tries to merge complete later pages into earlier pages
2. backfills individual parts from later pages into earlier pages
3. repacks both affected pages after every accepted move
4. removes empty pages and reindexes pages

Every candidate merge / move is accepted only when a fresh MaxRects solve can place the complete page without scaling.

### Packing gap control

The Inspector exposes the inter-part packing gap:

- 4–32 px
- default: 16 px

Changing the value does not silently alter the existing project. Use **全局优化分页** to repack with the new spacing.

### Page utilization

The UI now shows:

- utilization directly on every Page chip
- current-page utilization
- overall utilization across all generated pages
- number of parts on each page

Utilization is based on the actual no-scale part bounding areas used by the packing solver.

### V1.6 workspace redesign

The editor is now structured as a compact production workspace.

#### Top command bar

Upload, text filtering, split/edge controls, target size and export are grouped into a sticky compact command bar instead of large stacked cards.

#### Source

Original-image source contours and debug information stay on the left.

#### Canvas

The central Canvas is the primary visual area.

A clickable page strip sits directly above it:

- P1 / P2 / P3…
- part count
- utilization percentage

#### Inspector

The right-side Inspector contains, in workflow order:

1. cross-page transfer
2. page-utilization / gap controls
3. quality metrics
4. current-page part list

### V1.5 capabilities retained

- exact component-label masks
- internal RGB preservation
- precise source contours
- host-aware grouping
- continuous repair brush / eraser
- atomic Split
- multi-page export
- current-page PNG
- all-pages ZIP
- 3500×3500 / 2970×2100
- no-scale semantics
- DPI / PNG pHYs metadata
- Merge / Split / Undo / Redo

## Live site

https://invoidstar.github.io/pattern-layout-studio/

## Documentation

- [V1.6 implementation](docs/V1.6_IMPLEMENTATION.md)
- [V1.6 acceptance](docs/V1.6_ACCEPTANCE.md)
- [V1.5 implementation](docs/V1.5_IMPLEMENTATION.md)
- [V1.5 acceptance](docs/V1.5_ACCEPTANCE.md)

## Privacy

Image processing happens in the browser. Uploaded pattern images are not committed to this repository. Optional OCR downloads OCR runtime/language data only when enabled.
