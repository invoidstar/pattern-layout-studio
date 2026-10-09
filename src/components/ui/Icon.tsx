import type { CSSProperties } from 'react';

export type IconName =
  | 'layers' | 'bell' | 'settings' | 'plus' | 'upload' | 'download'
  | 'image' | 'canvas' | 'list' | 'cursor' | 'hand' | 'brush'
  | 'eraser' | 'undo' | 'redo' | 'zoom-in' | 'zoom-out'
  | 'maximize' | 'chevron-down' | 'chevron-left' | 'chevron-right'
  | 'x' | 'check' | 'more' | 'info' | 'move' | 'refresh'
  | 'lock' | 'unlock' | 'trash' | 'scissors' | 'merge' | 'archive'
  | 'file-image' | 'sparkles';

const paths: Record<IconName, string> = {
  layers:'M12 2 2 7l10 5 10-5-10-5Zm-10 10 10 5 10-5M2 17l10 5 10-5',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  settings:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15.5l2-1.5v-4l-2-1.5-.5-1.3 0-2.5-3.5-2-2 1-1.4 0-2-1-3.5 2 0 2.5-.5 1.3-2 1.5v4l2 1.5.5 1.3v2.5l3.5 2 2-1 1.4 0 2 1 3.5-2v-2.5l.5-1.3Z',
  plus:'M12 5v14M5 12h14',
  upload:'M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4',
  download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  image:'M3 3h18v18H3zM8 8h.01M3 17l6-6 4 4 3-3 5 5',
  canvas:'M4 4h16v16H4zM8 4v16M4 9h16',
  list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  cursor:'m5 3 14 9-8 1-3 8-3-18Z',
  hand:'M8 14V6a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v5c0 5-3 8-8 8h-1c-3 0-5-2-7-6l-1-2a1.5 1.5 0 0 1 2.6-1.5L8 15',
  brush:'m14 5 5 5M12 7l5-5 5 5-5 5-5-5ZM12 7 4 15l5 5 8-8M4 15c-1.5 1-2 3-2 5 2.5-.1 4-1.5 5-3',
  eraser:'m20 20H9M5 14l8-8 7 7-7 7H9l-4-4a3 3 0 0 1 0-4Z',
  undo:'M9 14 4 9l5-5M4 9h10a7 7 0 0 1 0 14',
  redo:'m15 14 5-5-5-5M20 9H10a7 7 0 0 0 0 14',
  'zoom-in':'M11 11H5m3-3v6M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  'zoom-out':'M5 11h6M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  maximize:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  'chevron-down':'m6 9 6 6 6-6',
  'chevron-left':'m15 18-6-6 6-6',
  'chevron-right':'m9 18 6-6-6-6',
  x:'M18 6 6 18M6 6l12 12',
  check:'m4 12 5 5L20 6',
  more:'M4 12h.01M12 12h.01M20 12h.01',
  info:'M12 17v-5M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  move:'M12 2v20M2 12h20m-4-4 4 4-4 4M8 6l4-4 4 4M6 8l-4 4 4 4m2 2 4 4 4-4',
  refresh:'M20 11a8 8 0 1 0-2 6l3 1M21 13v5h-5',
  lock:'M6 10h12v11H6zM9 10V7a3 3 0 0 1 6 0v3',
  unlock:'M6 10h12v11H6zM9 10V6a3 3 0 0 1 6 0',
  trash:'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  scissors:'M14 8 5 17M14 16 5 7M8 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0M14 12l7-7M14 12l7 7',
  merge:'M3 3h7v7H3zM14 3h7v7h-7zM9 14h6M12 10v11M5 21h14',
  archive:'M3 4h18v4H3zM5 8v13h14V8M10 12h4',
  'file-image':'M5 2h10l5 5v15H5zM15 2v5h5M8 18l4-4 2 2 2-2 2 4',
  sparkles:'m12 3 1.7 6.3L20 11l-6.3 1.7L12 19l-1.7-6.3L4 11l6.3-1.7L12 3ZM19 18l.8 2.2L22 21l-2.2.8L19 24l-.8-2.2L16 21l2.2-.8L19 18Z',
};

export default function Icon({
  name,
  size = 18,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
