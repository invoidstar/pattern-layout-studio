import type { PatternPart, SourceBox, SourceRegion } from '../../domain';

export function cloneParts(parts: PatternPart[]): PatternPart[] {
  return parts.map((part) => ({
    ...part,
    stats: part.stats
      ? {
          ...part.stats,
          sourceBox: part.stats.sourceBox ? { ...part.stats.sourceBox } : undefined,
          sourceBoxes: part.stats.sourceBoxes
            ? part.stats.sourceBoxes.map((box) => ({ ...box }))
            : undefined,
          sourceContours: part.stats.sourceContours
            ? part.stats.sourceContours.map((contour) =>
                contour.map((point) => ({ ...point })),
              )
            : undefined,
          sourceRegions: part.stats.sourceRegions
            ? part.stats.sourceRegions.map((region) => ({
                ...region,
                box: region.box ? { ...region.box } : undefined,
                contours: region.contours
                  ? region.contours.map((contour) =>
                      contour.map((point) => ({ ...point })),
                    )
                  : undefined,
              }))
            : undefined,
        }
      : undefined,
  }));
}

export function sourceRegionsFor(part: PatternPart): SourceRegion[] {
  if (part.stats?.sourceRegions?.length) {
    return part.stats.sourceRegions.map((region) => ({
      ...region,
      box: region.box ? { ...region.box } : undefined,
      contours: region.contours
        ? region.contours.map((contour) =>
            contour.map((point) => ({ ...point })),
          )
        : undefined,
    }));
  }

  if (!part.sourceId) return [];
  const boxes = part.stats?.sourceBoxes?.length
    ? part.stats.sourceBoxes
    : part.stats?.sourceBox
      ? [part.stats.sourceBox]
      : [];

  if (boxes.length) {
    return boxes.map((box, index) => ({
      sourceId: part.sourceId!,
      box: { ...box },
      contours:
        index === 0 && part.stats?.sourceContours?.length
          ? part.stats.sourceContours.map((contour) =>
              contour.map((point) => ({ ...point })),
            )
          : undefined,
    }));
  }

  return part.stats?.sourceContours?.length
    ? [{
        sourceId: part.sourceId,
        contours: part.stats.sourceContours.map((contour) =>
          contour.map((point) => ({ ...point })),
        ),
      }]
    : [];
}

export function sourceBoxesFor(
  part: PatternPart,
  sourceId?: string,
): SourceBox[] {
  const regions = sourceRegionsFor(part).filter(
    (region) => !sourceId || region.sourceId === sourceId,
  );
  const boxes = regions
    .map((region) => region.box)
    .filter((box): box is SourceBox => Boolean(box));
  if (boxes.length) return boxes;

  if (sourceId && part.sourceId !== sourceId) return [];
  if (part.stats?.sourceBoxes?.length) {
    return part.stats.sourceBoxes.map((box) => ({ ...box }));
  }
  return part.stats?.sourceBox ? [{ ...part.stats.sourceBox }] : [];
}

export function unionSourceBoxes(boxes: SourceBox[]): SourceBox | undefined {
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
