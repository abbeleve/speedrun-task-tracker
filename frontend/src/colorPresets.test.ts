import { describe, expect, it } from 'vitest';
import {
  COLOR_PRESETS_STORAGE_KEY,
  appearanceFromColorPreset,
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

  it('keeps avatars and normalized gradients without changing old color-only presets', () => {
    expect(normalizeColorPresets([
      { id: 'legacy', name: 'Legacy', color: '#3498db' },
      {
        id: 'focus', name: 'Focus', color: '#ABCDEF', emoji: ' 🚀 ',
        colorAnimation: {
          type: 'flow', colors: ['#ABCDEF', '#123456'], direction: 450, durationSec: 30,
        },
      },
      { id: 'solid', name: 'Solid', color: '#ffffff', emoji: '🎯', colorAnimation: null },
    ])).toEqual([
      { id: 'legacy', name: 'Legacy', color: '#3498db' },
      {
        id: 'focus', name: 'Focus', color: '#abcdef', emoji: '🚀',
        colorAnimation: {
          type: 'flow', colors: ['#abcdef', '#123456'], direction: 90, durationSec: 20,
        },
      },
      { id: 'solid', name: 'Solid', color: '#ffffff', emoji: '🎯', colorAnimation: null },
    ]);
  });

  it('applies the whole appearance while legacy presets keep the current avatar and gradient', () => {
    const current = {
      emoji: '📋',
      colorAnimation: {
        type: 'flow' as const, colors: ['#000000', '#ffffff'], direction: 0, durationSec: 6,
      },
    };
    expect(appearanceFromColorPreset(
      { id: 'old', name: 'Old', color: '#123456' }, current
    )).toEqual({ color: '#123456', ...current });
    expect(appearanceFromColorPreset(
      { id: 'new', name: 'New', color: '#abcdef', emoji: '🚀', colorAnimation: null }, current
    )).toEqual({ color: '#abcdef', emoji: '🚀', colorAnimation: null });
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
