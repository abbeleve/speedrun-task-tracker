import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  INTRO_TIMES,
  SCENE_LOAD_TIMEOUT_MS,
  SKIP_FADE_MS,
  STILL_INTRO_MS,
  handBackIntroScene,
  introBackground,
  introGreeting,
  introPalette,
  prefersStill,
  takeIntroScene,
} from './intro';
import type { IntroKind } from './intro';
import type { IntroScene } from './introScene';
import './intro.css';

const TITLE = 'SpeedRun Tasks';

// The longest step the shot's clock takes in one frame.
const MAX_FRAME_S = 0.1;

// loading  the scene's code is on its way; the overlay is a plain night sky
// playing  the 3D shot is running
// still    no motion wanted (or no WebGL): the title fades in and out
type Mode = 'loading' | 'playing' | 'still';

// The intro over the app as it opens (see intro.ts). The app is mounted
// underneath from the first frame, so its data loads while the shot plays,
// and the dial's face opens straight onto it. Any click, tap or key skips.
export default function LoginIntro({
  kind,
  user,
  onDone,
}: {
  kind: IntroKind;
  user: string | null;
  onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('loading');
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  // Skipped: the overlay fades away, whatever it was showing.
  const [leaving, setLeaving] = useState(false);
  const [palette] = useState(introPalette);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finishedRef = useRef(false);
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onDoneRef.current();
  }, []);

  const skip = useCallback(() => {
    if (modeRef.current === 'still') finish();
    else setLeaving(true);
  }, [finish]);

  useEffect(() => {
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [skip]);

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(finish, SKIP_FADE_MS);
    return () => window.clearTimeout(id);
  }, [leaving, finish]);

  useEffect(() => {
    if (mode === 'still') {
      const id = window.setTimeout(finish, STILL_INTRO_MS);
      return () => window.clearTimeout(id);
    }
  }, [mode, finish]);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const flash = flashRef.current;
    if (!root || !stage || !flash) return;
    if (prefersStill()) {
      setMode('still');
      return;
    }

    let disposed = false;
    let gaveUp = false;
    let started = false;
    let scene: IntroScene | null = null;
    let raf = 0;
    let t = 0;
    let last = 0;

    const settleStill = () => {
      if (disposed) return;
      gaveUp = true;
      setMode('still');
    };
    const giveUpTimer = window.setTimeout(settleStill, SCENE_LOAD_TIMEOUT_MS);

    const frame = (now: number) => {
      if (!scene) return;
      // A long stall (the app rendering its first screen underneath) slows
      // the shot down for a moment rather than jumping it ahead; a slow
      // device's ordinary frames still run it at full speed.
      t += last ? Math.min((now - last) / 1000, MAX_FRAME_S) : 0;
      last = now;
      const f = scene.draw(t);
      flash.style.opacity = f.flash.toFixed(3);
      // An attribute, not a class: React owns the class list, and a render
      // mid-reveal (a skip) must not close the hole again.
      if (f.holeRadius > 0) {
        root.style.setProperty('--intro-hole', `${f.holeRadius.toFixed(1)}px`);
        root.dataset.open = '';
      }
      if (f.done) {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    // The shot waits for the tab to be seen, and a tab put away mid-shot
    // comes back to the app, not to the rest of the intro.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        if (started) finish();
        return;
      }
      if (started || !scene) return;
      started = true;
      setMode((m) => (m === 'loading' ? 'playing' : m));
      raf = requestAnimationFrame(frame);
    };

    const onResize = () => {
      if (!scene) return;
      scene.resize(window.innerWidth, window.innerHeight);
      root.style.setProperty('--intro-watch-r', `${scene.watchRadius().toFixed(1)}px`);
    };

    const pending = takeIntroScene();
    pending
      .then((ready) => {
        // Too late: the still version has played instead.
        if (gaveUp) {
          ready.dispose();
          return;
        }
        // Gone before it arrived: the scene was handed back (see below).
        if (disposed) return;
        window.clearTimeout(giveUpTimer);
        scene = ready;
        stage.appendChild(scene.canvas);
        onResize();
        window.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', onVisibility);
        onVisibility();
      })
      .catch(() => {
        // No WebGL here, or the scene's code would not load.
        window.clearTimeout(giveUpTimer);
        settleStill();
      });

    return () => {
      disposed = true;
      window.clearTimeout(giveUpTimer);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (scene) {
        scene.canvas.remove();
        scene.dispose();
        scene = null;
      } else if (!gaveUp) {
        handBackIntroScene(pending);
      }
    };
  }, [finish]);

  const greeting = introGreeting(kind, user);
  const T = INTRO_TIMES;

  return (
    <div
      ref={rootRef}
      className={`intro intro--${mode}${leaving ? ' intro--leaving' : ''}`}
      style={
        {
          '--intro-base': palette.base,
          '--intro-bg': introBackground(palette.base),
          '--intro-text-in': `${T.textIn}s`,
          '--intro-text-out': `${T.go - 0.12}s`,
          '--intro-skip-fade': `${SKIP_FADE_MS}ms`,
          '--intro-still': `${STILL_INTRO_MS}ms`,
        } as CSSProperties
      }
      onPointerDown={skip}
      aria-hidden="true"
    >
      <div className="intro-stage" ref={stageRef} />
      <div className="intro-flash" ref={flashRef} />
      <div className="intro-caption">
        <div className="intro-title">
          {Array.from(TITLE, (ch, i) => (
            <span key={i} className="intro-letter" style={{ '--i': i } as CSSProperties}>
              {ch}
            </span>
          ))}
        </div>
        {greeting && <div className="intro-greeting">{greeting}</div>}
      </div>
      <div className="intro-skip">
        <span className="intro-skip-fine">Клик или любая клавиша — пропустить</span>
        <span className="intro-skip-touch">Коснитесь, чтобы пропустить</span>
      </div>
    </div>
  );
}
