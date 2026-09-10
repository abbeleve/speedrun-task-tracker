// Registry of motivational pictures for the List view. They are served by the
// backend from a plain directory (`MOTIVATION_DIR`, default `backend/data/`),
// so pictures stay out of git and can be dropped in on the server.
import { useEffect, useState } from 'react';

export async function fetchMotivationImages(): Promise<string[]> {
  const res = await fetch('/api/motivation');
  if (!res.ok) throw new Error(`Motivation images: ${res.status}`);
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as string[]) : [];
}

// Deterministic pick so the same task keeps the same picture across renders.
export function motivationImage(images: string[], seed: number): string | null {
  if (images.length === 0) return null;
  return images[Math.abs(seed) % images.length];
}

// One-shot fetch shared by all callers: images are global, not per-user.
let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

export function useMotivationImages(): string[] {
  const [images, setImages] = useState<string[]>(cache ?? []);

  useEffect(() => {
    if (cache) {
      setImages(cache);
      return;
    }
    if (!inflight) {
      inflight = fetchMotivationImages()
        .then((loaded) => {
          cache = loaded;
          return loaded;
        })
        .catch(() => {
          // Let a later mount retry rather than caching the failure.
          inflight = null;
          return [] as string[];
        });
    }
    let active = true;
    inflight.then((loaded) => {
      if (active) setImages(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  return images;
}
