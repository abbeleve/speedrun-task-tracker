import { describe, expect, it } from 'vitest';
import { scrollChildToTop } from './scrollWithin';

const box = (top: number) => ({ getBoundingClientRect: () => ({ top }) });

describe('scrollChildToTop', () => {
  it('scrolls down by how far the child sits below the scroll area', () => {
    const container = { ...box(100), scrollTop: 40, clientTop: 0 };
    scrollChildToTop(container, box(350));
    expect(container.scrollTop).toBe(290);
  });

  it('scrolls back up to a child above the visible area', () => {
    const container = { ...box(100), scrollTop: 500, clientTop: 0 };
    scrollChildToTop(container, box(-200));
    expect(container.scrollTop).toBe(200);
  });

  it('measures from inside the top border', () => {
    const container = { ...box(100), scrollTop: 0, clientTop: 1 };
    scrollChildToTop(container, box(301));
    expect(container.scrollTop).toBe(200);
  });
});
