import type { CanvasSize } from '../domain';

export const TARGETS: Record<'square' | 'a4', CanvasSize> = {
  square: { width: 3500, height: 3500, label: '3500 × 3500' },
  a4: { width: 2970, height: 2100, label: '2970 × 2100' },
};

export const DEFAULT_PACKING_GAP = 16;
export const HISTORY_LIMIT = 12;
