import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, sameKey } from './push';

describe('base64UrlToBytes', () => {
  it('decodes the url-safe alphabet without padding', () => {
    // 0xfb 0xff 0xfe is "+//+" in plain base64, "-__-" url-safe.
    expect([...base64UrlToBytes('-__-')]).toEqual([0xfb, 0xff, 0xfe]);
    expect([...base64UrlToBytes('AQI')]).toEqual([1, 2]);
  });
});

describe('sameKey', () => {
  const key = new Uint8Array([1, 2, 3]);

  it('matches the key a subscription was made with', () => {
    expect(sameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(true);
  });

  it('rejects another key, or none', () => {
    expect(sameKey(new Uint8Array([1, 2, 4]).buffer, key)).toBe(false);
    expect(sameKey(new Uint8Array([1, 2]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});
