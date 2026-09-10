import { describe, expect, it } from 'vitest';
import { motivationImage } from './motivation';

describe('motivationImage', () => {
  const images = ['/a.png', '/b.png', '/c.png'];

  it('picks deterministically by seed', () => {
    expect(motivationImage(images, 0)).toBe('/a.png');
    expect(motivationImage(images, 1)).toBe('/b.png');
    expect(motivationImage(images, 4)).toBe('/b.png');
  });

  it('handles negative seeds', () => {
    expect(motivationImage(images, -1)).toBe('/b.png');
  });

  it('returns null when there are no images', () => {
    expect(motivationImage([], 3)).toBeNull();
  });
});
