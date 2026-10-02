// The measured box of one Story path step, in CSS pixels.
export interface RailFrame {
  width: number;
  height: number;
  // Gap between the square picture and the side of the row the route bends on.
  inset: number;
  picture: number;
}

// One step's stretch of the route: a run along the top, a bend around the
// picture's side and a run back along the bottom, where the next step picks it
// up. The bend shares the picture's centre, so the picture's rounded side runs
// parallel to it; a row taller than the picture straightens the middle of the
// bend instead of widening it, which keeps every bend the same and the joins
// between rows in place.
export function storyRailPath({ width, height, inset, picture }: RailFrame, reverse: boolean, first: boolean): string {
  const r = Math.min(height / 2, inset + picture / 2);
  const near = reverse ? width - r : r;
  const far = reverse ? r : width - r;
  const edge = reverse ? width : 0;
  const sweep = reverse ? 1 : 0;
  // The first step starts above the picture's far edge rather than mid-bend.
  const start = first ? `M ${inset + picture} 0 H ${near}` : `M ${near} 0`;
  return `${start} A ${r} ${r} 0 0 ${sweep} ${edge} ${r} V ${height - r} A ${r} ${r} 0 0 ${sweep} ${near} ${height} H ${far}`;
}
