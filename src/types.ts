export interface CanvasSize {
  width: number;
  height: number;
  label: string;
}

export interface PartStats {
  area?: number;
  fillRatio?: number;
  textExcluded?: boolean;
  smoothingApplied?: boolean;
  sourceBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PatternPart {
  id: string;
  name: string;
  imageUrl: string;
  sourceImageUrl?: string;
  width: number;
  height: number;
  x: number;
  y: number;
  pageIndex?: number;
  locked: boolean;
  visible: boolean;
  overflow?: boolean;
  stats?: PartStats;
}

export interface LayoutPage {
  index: number;
  width: number;
  height: number;
  partIds: string[];
}
