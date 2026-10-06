import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { HabitStreak } from './streak';
import { formatAmount, pluralDays, pluralSavers } from './streak';
import { IconSnowflake } from './icons';
import './streak.css';

// The streak's fire, in the habit's own colour: three tongues of flame — a
// saturated outer one, a lighter middle and a near-white core — each swaying
// at its own pace, so the fire never visibly loops. The number sits in the
// light body of the flame. Sized by its container's width (see streak.css);
// every colour is derived from --habit-color.

const OUTER =
  'M56 3C62 22 76 30 82 44C85 37 85 31 83 24C95 38 97 60 92 78C87 102 70 118 50 118' +
  'C30 118 10 104 8 82C6 64 12 46 22 30C24 40 28 46 34 50C33 32 42 16 56 3Z';
const MIDDLE =
  'M54 30C59 48 71 55 75 70C77 64 77 60 76 55C84 66 86 81 82 92C77 107 64 113 50 113' +
  'C35 113 20 105 18 89C17 76 22 66 29 57C30 65 34 70 39 72C38 57 44 42 54 30Z';
const CORE =
  'M52 58C57 72 68 77 68 92C68 105 59 111 50 111C41 111 32 105 32 94C32 85 37 80 42 76' +
  'C43 82 45 85 47 86C46 77 48 67 52 58Z';

interface StreakFlameProps {
  lit: boolean; // burning (swaying, glowing) or a still, unlit shape
  className?: string;
  children?: ReactNode; // the number, laid over the flame's body
}

export function StreakFlame({ lit, className, children }: StreakFlameProps) {
  // Gradient ids must be unique per flame on the page.
  const id = `flame${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <span className={`streak-flame${lit ? ' is-lit' : ''}${className ? ` ${className}` : ''}`}>
      <svg className="streak-flame-svg" viewBox="0 0 100 120" aria-hidden focusable="false">
        <defs>
          <radialGradient id={`${id}-o`} cx="0.5" cy="0.88" r="0.9">
            <stop offset="0" style={{ stopColor: 'var(--flame-hot)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--flame)' }} />
            <stop offset="1" style={{ stopColor: 'var(--flame-deep)' }} />
          </radialGradient>
          <linearGradient id={`${id}-m`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--flame-hot)' }} />
            <stop offset="0.6" style={{ stopColor: 'var(--flame-light)' }} />
          </linearGradient>
          <radialGradient id={`${id}-c`} cx="0.5" cy="0.75" r="0.75">
            <stop offset="0" style={{ stopColor: '#fff' }} />
            <stop offset="1" style={{ stopColor: 'var(--flame-core)' }} />
          </radialGradient>
        </defs>
        <path className="streak-flame-outer" d={OUTER} fill={`url(#${id}-o)`} />
        <path className="streak-flame-mid" d={MIDDLE} fill={`url(#${id}-m)`} />
        <path className="streak-flame-core" d={CORE} fill={`url(#${id}-c)`} />
      </svg>
      {children}
    </span>
  );
}

function numClass(days: number): string {
  return `streak-flame-num${days >= 100 ? ' is-long' : ''}`;
}

interface StreakBadgeProps {
  streak: HabitStreak;
  // What the badge reads and whether it burns — held at the old state while
  // the celebration flies the new fire into it.
  days: number;
  lit: boolean;
  warnHours: number | null; // 3 / 2 / 1 hours of the day left, or null
  unit: string;
  // Yesterday ended short of the quota and a saver kept the streak alive.
  savedYesterday: boolean;
  // Bumped when a celebration lands, to pop the badge.
  pop: number;
  flameRef: RefObject<HTMLSpanElement | null>;
}

// The little fire in the corner of a habit card's chart, with the streak's
// length in it. Burning once today's quota is met; a cold, still shape until
// then — a streak carried from yesterday keeps its number, a broken one reads
// 0 — and iced over while it is frozen: yesterday was missed and a saver
// spent on it. With three hours or less to midnight it starts to smoulder and
// says how many hours are left: red when the streak would burn, icy blue when
// a saver will step in. Under the fire, the savers in hand.
export function StreakBadge({
  streak,
  days,
  lit,
  warnHours,
  unit,
  savedYesterday,
  pop,
  flameRef,
}: StreakBadgeProps) {
  const risk = !lit && warnHours !== null;
  // A saver will be spent tonight unless the quota is met first.
  const covered = risk && days > 0 && streak.savers > 0;
  const state = lit
    ? 'is-lit'
    : risk
      ? `is-risk${covered ? ' is-covered' : ''}`
      : savedYesterday && days > 0
        ? 'is-frozen'
        : days > 0
          ? 'is-waiting'
          : 'is-cold';
  const left = `${formatAmount(streak.left)}${unit ? ` ${unit}` : ''}`;
  const run = `${days} ${pluralDays(days)} подряд`;
  const title = lit
    ? `Серия: ${run} — сегодня норма выполнена`
    : covered
      ? `Серию ${days} ${pluralDays(days)} через ${warnHours} ч спасёт заморозка — осталось ${left}`
      : risk
        ? days > 0
          ? `Серия ${days} ${pluralDays(days)} сгорит через ${warnHours} ч — осталось ${left}`
          : `До конца дня ${warnHours} ч — осталось ${left}, чтобы зажечь серию`
        : savedYesterday && days > 0
          ? `Серия: ${run} — вчера её спасла заморозка. Выполни норму сегодня, чтобы продлить`
          : days > 0
            ? `Серия: ${run} — выполни норму сегодня, чтобы продлить`
            : 'Серии пока нет — выполни норму сегодня, чтобы зажечь огонь';
  return (
    <span className={`streak-badge ${state}`}>
      <span className="streak-badge-main" role="img" aria-label={title} title={title}>
        <span key={pop} ref={flameRef} className={`streak-badge-fire${pop > 0 ? ' is-popping' : ''}`}>
          <StreakFlame lit={lit}>
            <span className={numClass(days)}>{days}</span>
          </StreakFlame>
        </span>
        {risk && <span className="streak-badge-left">{warnHours} ч</span>}
      </span>
      <StreakSavers savers={streak.savers} armed={covered} savedYesterday={savedYesterday} />
    </span>
  );
}

// The savers in hand: a snowflake and a count, dim at zero. Armed — glowing —
// when one is about to be spent on tonight.
function StreakSavers({ savers, armed, savedYesterday }: {
  savers: number;
  armed: boolean;
  savedYesterday: boolean;
}) {
  const how =
    'Если день закончится без нормы, заморозка сама сохранит серию. Новая — каждый понедельник, неиспользованные копятся';
  const title = `${savedYesterday ? 'Вчера серию спасла заморозка. ' : ''}${
    savers > 0
      ? `${savers} ${pluralSavers(savers)} в запасе. ${how}`
      : 'Заморозок нет — новая придёт в понедельник. Без неё пропущенный день сожжёт серию'
  }`;
  return (
    <span
      className={`streak-savers${savers === 0 ? ' is-empty' : ''}${armed ? ' is-armed' : ''}`}
      role="img"
      aria-label={title}
      title={title}
    >
      <IconSnowflake size={11} strokeWidth={2.25} />
      <span className="streak-savers-num">{savers}</span>
    </span>
  );
}

// The celebration, in ms: the fire bursts up in the middle of the card, the
// count rolls over, and then the fire flies into the corner badge.
const FLY_AT_MS = 2300;
const DONE_MS = 2950;
const EMBERS = 26;

interface Ember {
  x: number;
  y: number;
  size: number;
  delay: number;
  time: number;
}

// Sparks thrown mostly upwards, in two waves: one with the ignition, one as
// the new number lands.
function makeEmbers(): Ember[] {
  return Array.from({ length: EMBERS }, (_, i) => {
    const second = i % 3 === 0;
    const angle = ((-90 + (Math.random() - 0.5) * 160) * Math.PI) / 180;
    const dist = 70 + Math.random() * 120;
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist - 30,
      size: 3 + Math.random() * 5,
      delay: (second ? 1.0 : 0.2) + Math.random() * 0.4,
      time: 0.9 + Math.random() * 0.8,
    };
  });
}

interface StreakBurstProps {
  days: number; // the streak, today included
  target: RefObject<HTMLSpanElement | null>; // the badge's fire to fly into
  onDone: () => void;
}

// Today's quota is met: the card catches fire. Over a blurred, tinted veil a
// big flame ignites from its base with a shockwave and a spray of embers, the
// number inside it rolls from yesterday's streak to today's, and the fire
// shrinks into the corner badge, which pops as it lands. A click skips it.
export function StreakBurst({ days, target, onDone }: StreakBurstProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [embers] = useState(makeEmbers);

  // Where the badge is, relative to the hero: the flight's end.
  useLayoutEffect(() => {
    const hero = heroRef.current?.getBoundingClientRect();
    const badge = target.current?.getBoundingClientRect();
    const root = rootRef.current;
    if (!hero || !badge || !root || hero.width === 0) return;
    root.style.setProperty('--fly-x', `${badge.left + badge.width / 2 - (hero.left + hero.width / 2)}px`);
    root.style.setProperty('--fly-y', `${badge.top + badge.height / 2 - (hero.top + hero.height / 2)}px`);
    root.style.setProperty('--fly-s', String(badge.width / hero.width));
  }, [target]);

  useEffect(() => {
    const id = setTimeout(onDone, DONE_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <div
      ref={rootRef}
      className="streak-burst"
      onClick={onDone}
      role="status"
      aria-label={`Серия: ${days} ${pluralDays(days)} подряд`}
      style={{ '--burst-ms': `${DONE_MS}ms`, '--fly-at': `${FLY_AT_MS}ms` } as React.CSSProperties}
    >
      <div className="streak-burst-veil" />
      <div className="streak-burst-stage">
        <div ref={heroRef} className="streak-burst-hero">
          <span className="streak-burst-flare" />
          <span className="streak-burst-ring" />
          <span className="streak-burst-ring streak-burst-ring--late" />
          <StreakFlame lit>
            <span className={`${numClass(days - 1)} streak-burst-num streak-burst-num-old`}>
              {Math.max(0, days - 1)}
            </span>
            <span className={`${numClass(days)} streak-burst-num streak-burst-num-new`}>{days}</span>
          </StreakFlame>
          {embers.map((e, i) => (
            <span
              key={i}
              className="streak-ember"
              style={
                {
                  '--x': `${e.x}px`,
                  '--y': `${e.y}px`,
                  '--s': `${e.size}px`,
                  '--d': `${e.delay}s`,
                  '--t': `${e.time}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
        <div className="streak-burst-caption">
          <strong>
            {days} {pluralDays(days)} подряд
          </strong>
          <span>{days === 1 ? 'Огонь зажжён — серия началась' : 'Норма выполнена — серия растёт'}</span>
        </div>
      </div>
    </div>
  );
}
