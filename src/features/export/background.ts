export type ExportBackgroundMode = 'detected' | 'white' | 'custom' | 'transparent';

export const EXPORT_BACKGROUND_PRESETS = [
  { label: '白色', color: '#ffffff' },
  { label: '浅灰', color: '#f0f2f6' },
  { label: '米白', color: '#fff4e5' },
  { label: '淡蓝', color: '#eaf0ff' },
] as const;

/**
 * Returns the canvas background paint for export only.
 * The sentinel 'transparent' means leave the canvas pixels clear; it never
 * modifies part RGB, source masks or the editor preview.
 */
export function resolveExportBackground(
  mode: ExportBackgroundMode,
  detectedBackground: string,
  customColor: string,
): string {
  switch (mode) {
    case 'detected':
      return detectedBackground;
    case 'white':
      return '#ffffff';
    case 'transparent':
      return 'transparent';
    case 'custom':
      return /^#[0-9a-fA-F]{6}$/.test(customColor)
        ? customColor
        : '#ffffff';
  }
}
