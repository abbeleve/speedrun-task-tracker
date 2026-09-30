// How wide a line of text is in a given font, measured on an offscreen canvas
// and remembered. Nothing on the page is laid out or read, so it is cheap
// enough to call on every render (the calendar redraws on every clock tick).

const cache = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;
let family: string | undefined;

function canvas(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  context =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  // A width taken before the web font arrived is the fallback font's.
  if (typeof document !== 'undefined') {
    document.fonts?.addEventListener?.('loadingdone', () => cache.clear());
  }
  return context;
}

// The page's own font family, so a measured width matches what is drawn.
function uiFamily(): string {
  if (family === undefined) {
    family =
      (typeof document !== 'undefined' && getComputedStyle(document.body).fontFamily) ||
      'Inter, sans-serif';
  }
  return family;
}

// `style` is the CSS font shorthand without the family: 'italic 600 12px'.
export function textWidth(text: string, style: string): number {
  const font = `${style} ${uiFamily()}`;
  const key = `${font}\n${text}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const ctx = canvas();
  let width: number;
  if (ctx) {
    ctx.font = font;
    width = ctx.measureText(text).width;
  } else {
    // No canvas (a test run): a rough average glyph of the font's size.
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(style)?.[1] ?? 12);
    width = text.length * size * 0.6;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, width);
  return width;
}
