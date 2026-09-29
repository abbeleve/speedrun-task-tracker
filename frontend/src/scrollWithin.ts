// Scrolls `container` so `child` starts at the top of its visible area.
// `scrollIntoView` does the same but also scrolls every scrollable ancestor
// on the way — inside the home dashboard that dragged the whole page down to
// the sleep tracker the moment it mounted.

interface Box {
  getBoundingClientRect(): { top: number };
}

export interface ScrollBox extends Box {
  scrollTop: number;
  // Width of the top border: the scroll area starts below it.
  clientTop: number;
}

export function scrollChildToTop(container: ScrollBox, child: Box): void {
  const scrollportTop = container.getBoundingClientRect().top + container.clientTop;
  container.scrollTop += child.getBoundingClientRect().top - scrollportTop;
}
