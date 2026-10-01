import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageStoryImages, shuffleStoryImages, storyImage } from './storyImages';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('story image deck', () => {
  const images = ['/a.jpg', '/b.jpg', '/c.jpg'];

  it('shuffles without mutating the source or duplicating any picture', () => {
    const input = [...images, images[0]];
    const deck = shuffleStoryImages(input, [], () => 0);
    expect(deck).toEqual(['/b.jpg', '/c.jpg', '/a.jpg']);
    expect(new Set(deck).size).toBe(images.length);
    expect(input).toEqual([...images, images[0]]);
  });

  it('exhausts each deck before looping it in the same order', () => {
    const deck = shuffleStoryImages(images, [], () => 0.99);
    const picks = Array.from({ length: 9 }, (_, idx) => storyImage(deck, idx));
    expect(picks).toEqual([...images, ...images, ...images]);
    expect(picks[2]).not.toBe(picks[3]);
  });

  it('changes the order even when a reload produces the same random shuffle', () => {
    expect(shuffleStoryImages(images, images, () => 0.99)).toEqual(['/b.jpg', '/c.jpg', '/a.jpg']);
  });

  it('handles empty and single-image collections', () => {
    expect(storyImage([], 0)).toBeNull();
    expect(shuffleStoryImages([])).toEqual([]);
    expect(shuffleStoryImages(['/only.jpg'], ['/only.jpg'])).toEqual(['/only.jpg']);
    expect(storyImage(['/only.jpg'], 50)).toBe('/only.jpg');
  });

  it('keeps one deck through ticks, switching views, and equivalent registry arrays', () => {
    const deck = pageStoryImages(['/stable1.jpg', '/stable2.jpg']);
    expect(pageStoryImages(['/stable1.jpg', '/stable2.jpg'])).toBe(deck);
    expect(pageStoryImages([])).toEqual([]);
  });

  it('remembers the previous page order and changes it across module reloads', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    vi.resetModules();
    const firstPage = await import('./storyImages');
    const first = firstPage.pageStoryImages(images);
    vi.resetModules();
    const secondPage = await import('./storyImages');
    const second = secondPage.pageStoryImages(images);
    expect(first).toEqual(images);
    expect(second).not.toEqual(first);
    expect([...second].sort()).toEqual([...images].sort());
  });

  it('works with broken or blocked storage', async () => {
    vi.resetModules();
    const module = await import('./storyImages');
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(module.pageStoryImages(images)).toHaveLength(3);
  });
});
