import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('color preset API', () => {
  it('finishes ordered writes before loading presets again', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'session-token' });
    let releaseFirst!: (response: Response) => void;
    const firstWrite = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    const requests: string[] = [];
    const saved = [{ id: 'math', name: 'Матан', color: '#e74c3c' }];
    const fetchMock = vi.fn((_url: string, options: RequestInit) => {
      if (options?.method === 'PUT') {
        requests.push(`PUT ${JSON.parse(options.body as string)[0].id}`);
        return requests.length === 1
          ? firstWrite
          : Promise.resolve(new Response(null, { status: 204 }));
      }
      requests.push('GET');
      return Promise.resolve(new Response(JSON.stringify(saved), {
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = await import('./api');

    const first = api.saveColorPresets([{ id: 'call', name: 'Созвон', color: '#2ecc71' }]);
    const second = api.saveColorPresets(saved);
    const loaded = api.loadColorPresets();
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toEqual(['PUT call']);

    releaseFirst(new Response(null, { status: 204 }));
    await Promise.all([first, second]);
    expect(await loaded).toEqual(saved);
    expect(requests).toEqual(['PUT call', 'PUT math', 'GET']);
  });
});
