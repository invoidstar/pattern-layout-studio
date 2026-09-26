export interface CanvasSize {
  width: number;
  height: number;
  label: string;
}

export interface PatternPart {
  id: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  x: number;
  y: number;
  locked: boolean;
  visible: boolean;
  overflow?: boolean;
}
