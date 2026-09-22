import { describe, expect, it } from 'vitest';
import {
  COLOR_PRESETS_STORAGE_KEY,
  loadColorPresets,
  normalizeColorPresets,
  saveColorPresets,
} from './colorPresets';

describe('color presets', () => {
  it('keeps only named, valid, unique presets', () => {
    expect(
      normalizeColorPresets([
        { id: ' calls ', name: ' Созвоны ', color: '#E74C3C' },
        { id: 'calls', name: 'Duplicate', color: '#3498db' },
        { id: 'bad-color', name: 'Bad', color: 'red' },
        { id: 'no-name', name: '   ', color: '#3498db' },
        null,
      ])
    ).toEqual([{ id: 'calls', name: 'Созвоны', color: '#e74c3c' }]);
  });

  it('round-trips presets through storage', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    };
    const presets = [{ id: 'walk', name: 'Прогулка', color: '#2ecc71' }];

    saveColorPresets(presets, storage);
    expect(data.has(COLOR_PRESETS_STORAGE_KEY)).toBe(true);
    expect(loadColorPresets(storage)).toEqual(presets);
  });

  it('returns an empty list for broken saved JSON', () => {
    expect(loadColorPresets({ getItem: () => '{broken' })).toEqual([]);
  });
});
