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

// The old browser-only list is read once during migration to the account DB.
export function loadLegacyColorPresets(storage: Pick<Storage, 'getItem'> = localStorage): ColorPreset[] {
  try {
    const raw = storage.getItem(COLOR_PRESETS_STORAGE_KEY);
    return raw ? normalizeColorPresets(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function clearLegacyColorPresets(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(COLOR_PRESETS_STORAGE_KEY);
  } catch {
    // Browser storage may be disabled; the server remains authoritative.
  }
}

export function moveColorPreset(presets: ColorPreset[], index: number, offset: -1 | 1): ColorPreset[] {
  const target = index + offset;
  if (index < 0 || index >= presets.length || target < 0 || target >= presets.length) return presets;
  const next = [...presets];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function newColorPresetId(): string {
  return `color-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
