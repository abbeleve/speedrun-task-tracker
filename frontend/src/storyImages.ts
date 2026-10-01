// One shuffled deck per page load. Every picture is used before the deck loops.
export function shuffleStoryImages(
  images: readonly string[],
  previous: readonly string[] = [],
  random: () => number = Math.random,
): string[] {
  const deck = [...new Set(images)];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // Even if the shuffle happens to match, a reload changes the order.
  if (deck.length > 1 && deck.every((url, i) => url === previous[i])) {
    deck.push(deck.shift()!);
  }
  return deck;
}

export function storyImage(deck: readonly string[], index: number): string | null {
  if (deck.length === 0) return null;
  return deck[((index % deck.length) + deck.length) % deck.length];
}

const STORAGE_KEY = 'speedrun_story_images';
const pageDecks = new Map<string, string[]>();

export function pageStoryImages(images: readonly string[]): string[] {
  if (images.length === 0) return [];
  const key = JSON.stringify(images);
  const cached = pageDecks.get(key);
  if (cached) return cached;

  let previous: string[] = [];
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(saved) && saved.every((url) => typeof url === 'string')) previous = saved;
  } catch {
    // Pictures still work when storage is unavailable.
  }
  const deck = shuffleStoryImages(images, previous);
  pageDecks.set(key, deck);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
  } catch {
    // The in-memory deck keeps pictures stable throughout this page load.
  }
  return deck;
}
