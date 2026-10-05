import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LoginIntro from './LoginIntro';
import { INTRO_TIMES, introBackground } from './intro';
import { PALETTE_CACHE_KEY } from './dashPalette';

// The overlay as the server renders it: before its effects run, so before the
// 3D scene arrives — the night sky, the caption and the skip hint.

vi.stubGlobal('localStorage', {
  getItem: (key: string) =>
    key === PALETTE_CACHE_KEY ? JSON.stringify({ active: 'ocean', own: [] }) : null,
});

const render = (kind: 'welcome' | 'return', user: string | null) =>
  renderToStaticMarkup(<LoginIntro kind={kind} user={user} onDone={() => {}} />);

describe('LoginIntro', () => {
  it('waits on the night sky until its scene is ready', () => {
    const html = render('return', 'ann');
    expect(html).toContain('class="intro intro--loading"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('spells the title out letter by letter, each with its place in the stagger', () => {
    const html = render('return', 'ann');
    const letters = html.match(/class="intro-letter"/g) ?? [];
    expect(letters).toHaveLength('SpeedRun Tasks'.length);
    expect(html).toContain('style="--i:13"');
  });

  it('greets by name, and leaves the greeting out until the name is known', () => {
    expect(render('welcome', 'ann')).toContain('Добро пожаловать, ann');
    expect(render('return', 'ann')).toContain('С возвращением, ann');
    expect(render('return', null)).not.toContain('intro-greeting');
  });

  it('opens in the colours this browser last saw the app in', () => {
    const html = render('return', 'ann');
    expect(html).toContain('--intro-base:#2f7fd8');
    expect(html).toContain(`--intro-bg:${introBackground('#2f7fd8')}`);
  });

  it('times the caption from the shot’s script', () => {
    const html = render('return', 'ann');
    expect(html).toContain(`--intro-text-in:${INTRO_TIMES.textIn}s`);
    expect(html).toContain(`--intro-text-out:${INTRO_TIMES.go - 0.12}s`);
  });
});
