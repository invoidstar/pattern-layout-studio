# Pattern Layout Studio

Browser-side pattern-part extraction, exact shape masking, multi-source provenance, unified multi-image page layout editing and PNG/ZIP export.

## V1.7

V1.7 upgrades the project from a single-source editor into a **multi-image project workspace**.

The pipeline is now:

**Select multiple images → sequential per-source extraction → exact source provenance → combine all parts → unified global page packing → cross-page editing → PNG / ZIP export**

### Multi-image upload

The upload control accepts one or more:

- PNG
- JPEG
- WebP

When multiple files are selected, they are processed sequentially to avoid running several large image pipelines in memory at the same time.

Progress is reported as:

`1 / N → 2 / N → ... → N / N`

After all successful sources have been extracted, their parts are combined into one project and sent through the page solver **once**.

This is important: the tool does not make separate pages per source image. Parts from different originals can share the same page when that improves utilization.

### Unified page packing

All extracted parts from all successful sources are combined before:

- MaxRects page generation
- global whole-page merging
- cross-page backfill
- page compaction

Therefore:

> Source A part + Source B part + Source C part can all be placed on Page 1.

All V1.6 page features remain available:

- cross-page transfer
- previous / next page move
- create new page
- global page optimization
- packing-gap control
- utilization metrics

### Multi-source provenance

Every automatic part stores a `sourceId` and a source region containing:

- original source image ID
- crop box
- exact source contours

Selecting a normal part automatically switches Source Trace to its original image.

The Source panel now includes an original-image thumbnail strip:

- S1
- S2
- S3
- ...

Users can also switch sources manually.

### Merge / split across sources

Manual Merge can combine parts originating from different source images.

The merged part keeps multiple independent `sourceRegions`, so provenance is not flattened into one invalid coordinate system.

For a merged multi-source part:

- Source 1 can display the Source 1 contribution
- Source 2 can display the Source 2 contribution
- switching Source does not lose the selection

Split preserves or refines provenance when the mapping is unambiguous.

### Batch failure behavior

If one selected image fails processing:

- the remaining successful images still form the project
- the failed-source count is shown in the status
- processing only stops completely when every selected image fails

### V1.6 / V1.5 capabilities retained

- exact component-label masks
- internal RGB preservation
- source contour overlay
- host-aware grouping
- text filtering / optional OCR
- continuous repair brush / eraser
- atomic Split
- global page compaction
- cross-page transfer
- current-page PNG
- all-pages ZIP
- 3500×3500 / 2970×2100
- no-scale semantics
- DPI / PNG pHYs metadata
- Undo / Redo

## Live site

https://invoidstar.github.io/pattern-layout-studio/

## Documentation

- [V1.7 implementation](docs/V1.7_IMPLEMENTATION.md)
- [V1.7 acceptance](docs/V1.7_ACCEPTANCE.md)
- [V1.6 implementation](docs/V1.6_IMPLEMENTATION.md)
- [V1.6 acceptance](docs/V1.6_ACCEPTANCE.md)

## Privacy

Image processing happens in the browser. Uploaded images are not committed to this repository. Optional OCR downloads OCR runtime/language data only when enabled.
