import { describe, expect, it } from 'vitest';
import {
  COLOR_PRESETS_STORAGE_KEY,
  clearLegacyColorPresets,
  loadLegacyColorPresets,
  moveColorPreset,
  normalizeColorPresets,
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

  it('reads old browser presets for migration and clears them afterward', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => data.delete(key),
    };
    const presets = [{ id: 'walk', name: 'Прогулка', color: '#2ecc71' }];

    data.set(COLOR_PRESETS_STORAGE_KEY, JSON.stringify(presets));
    expect(loadLegacyColorPresets(storage)).toEqual(presets);
    clearLegacyColorPresets(storage);
    expect(data.has(COLOR_PRESETS_STORAGE_KEY)).toBe(false);
  });

  it('returns an empty list for broken saved JSON', () => {
    expect(loadLegacyColorPresets({ getItem: () => '{broken' })).toEqual([]);
  });

  it('moves a preset one position without mutating the previous order', () => {
    const presets = [
      { id: 'call', name: 'Созвон', color: '#2ecc71' },
      { id: 'math', name: 'Матан', color: '#e74c3c' },
    ];
    expect(moveColorPreset(presets, 1, -1).map((preset) => preset.id)).toEqual(['math', 'call']);
    expect(presets.map((preset) => preset.id)).toEqual(['call', 'math']);
    expect(moveColorPreset(presets, 0, -1)).toBe(presets);
  });
});
