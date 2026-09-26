# Pattern Layout Studio

Browser-side pattern-part extraction, exact shape masking, source tracing, no-scale multi-page layout editing and PNG/ZIP export.

## V1.5

The current pipeline is:

**Upload → text exclusion → morphology → exact component labels → host-aware logical grouping → exact shape mask → internal RGB preservation → source contours → multi-page MaxRects → repair editor → PNG / ZIP**

### Exact shape extraction

V1.5 no longer treats a bounding rectangle as the part itself.

Each significant connected component receives an integer label. After host-aware grouping, every logical part keeps the exact labels that belong to it. The local crop mask is reconstructed from those labels only.

This means:

- unrelated foreground inside the same bounding rectangle is excluded;
- neighbouring parts no longer contaminate one another;
- bounding boxes are only storage / crop bounds;
- alpha comes from the exact logical-part mask.

### Preserve original colours

Internal colours are no longer removed merely because they are close to the global background colour.

For each logical part, background connected to the crop border stays transparent, while enclosed interior regions are restored into the silhouette before the original RGB crop is applied.

This prevents face / garment interiors from turning into unintended alpha holes.

### Shape-level source trace

The Source Trace panel now prefers exact contours over rectangular boxes.

- automatic parts store original-image contours
- selected parts highlight their real source shape
- merged parts retain multiple source contours
- split parts refine the source contour when exact mapping is possible
- rectangles remain only as a fallback / coordinate summary

### Split fix

Split is now an atomic parent replacement:

- parent part is removed
- child parts are inserted in the same state update
- stale parent image cache is discarded
- selection switches to the children
- source provenance is updated

The parent part cannot remain in the layout after a successful split.

### Brush / eraser rewrite

The repair tools now use continuous stroke interpolation instead of sparse pointer-event dabs.

Restore brush:

- reads from the raw, unmasked source crop
- restores original RGB + alpha
- interpolates between pointer samples
- has a larger transparent repair margin around automatic crops

Eraser uses the same continuous interpolation and removes alpha smoothly along the stroke.

### V1.4 / V1.3 capabilities retained

- three-column Source / Canvas / Parts workspace
- source coordinate display
- host-aware over-segmentation reduction
- text filtering / optional OCR
- smooth contours
- automatic multi-page packing
- current-page PNG
- all-pages ZIP
- 3500×3500
- 2970×2100
- no-scale dimensions
- configurable DPI / PNG pHYs metadata
- merge / split / Undo / Redo

## Live site

https://invoidstar.github.io/pattern-layout-studio/

## Documentation

- [V1.5 implementation](docs/V1.5_IMPLEMENTATION.md)
- [V1.5 acceptance](docs/V1.5_ACCEPTANCE.md)
- [V1.4 implementation](docs/V1.4_IMPLEMENTATION.md)
- [V1.4 acceptance](docs/V1.4_ACCEPTANCE.md)
- [V1.3.1 acceptance](docs/V1.3.1_ACCEPTANCE.md)

## Privacy

Image processing happens in the browser. Uploaded pattern images are not committed to this repository. Optional OCR downloads OCR runtime/language data only when enabled.
