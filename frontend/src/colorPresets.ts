export interface ColorPreset {
  id: string;
  name: string;
  color: string;
}

export const COLOR_PRESETS_STORAGE_KEY = 'speedrun_color_presets_v1';
const HEX_RE = /^#[0-9a-f]{6}$/i;

export function normalizeColorPresets(value: unknown): ColorPreset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const result: ColorPreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
    const color = typeof raw.color === 'string' ? raw.color.toLowerCase() : '';
    if (!id || ids.has(id) || !name || !HEX_RE.test(color)) continue;
    ids.add(id);
    result.push({ id, name, color });
  }
  return result;
}

export function loadColorPresets(storage: Pick<Storage, 'getItem'> = localStorage): ColorPreset[] {
  try {
    const raw = storage.getItem(COLOR_PRESETS_STORAGE_KEY);
    return raw ? normalizeColorPresets(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveColorPresets(
  presets: ColorPreset[],
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  try {
    storage.setItem(COLOR_PRESETS_STORAGE_KEY, JSON.stringify(normalizeColorPresets(presets)));
  } catch {
    // A blocked/full localStorage should not prevent editing the task itself.
  }
}

export function newColorPresetId(): string {
  return `color-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
