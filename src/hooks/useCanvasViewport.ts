import { useCallback, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

export interface CanvasView {
  scale: number;
  x: number;
  y: number;
}

type Point = { x: number; y: number };
type Pinch = { distance: number; center: Point; initial: CanvasView };

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 4;
export function clampZoom(scale: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export function useCanvasViewport() {
  const [view, setView] = useState<CanvasView>({ scale: 1, x: 0, y: 0 });
  const points = useRef<Map<number, Point>>(new Map());
  const pinch = useRef<Pinch | null>(null);

  const reset = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 });
    points.current.clear();
    pinch.current = null;
  }, []);

  const zoomBy = (factor: number) => setView((v) => ({
    ...v,
    scale: clampZoom(v.scale * factor),
  }));

  const beginPan = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    if (!element.hasPointerCapture(event.pointerId)) {
      element.setPointerCapture(event.pointerId);
    }
    points.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (points.current.size >= 2) {
      const [a, b] = Array.from(points.current.values()).slice(0, 2);
      pinch.current = {
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        center: midpoint(a, b),
        initial: { ...view },
      };
    }
  };

  const movePan = (event: PointerEvent<HTMLCanvasElement>) => {
    const previous = points.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    points.current.set(event.pointerId, next);

    if (points.current.size >= 2 && pinch.current) {
      const [a, b] = Array.from(points.current.values()).slice(0, 2);
      const currentCenter = midpoint(a, b);
      const currentDistance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const start = pinch.current;
      setView({
        scale: clampZoom(start.initial.scale * currentDistance / start.distance),
        x: start.initial.x + currentCenter.x - start.center.x,
        y: start.initial.y + currentCenter.y - start.center.y,
      });
    } else if (points.current.size === 1) {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      setView((current) => ({
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      }));
    }
  };

  const endPan = (event: PointerEvent<HTMLCanvasElement>) => {
    points.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pinch.current = null;
  };

  return { view, reset, zoomBy, beginPan, movePan, endPan };
}
