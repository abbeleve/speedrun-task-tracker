// Editor for one session — a run of blocks the calendar treats as a whole.
//
// A session is always explicit: blocks only ever hold together because they
// were glued by hand, and then they keep whatever gaps are inside them, move as
// one and carry a name. Blocks that merely follow each other are not a session
// and never become one on their own. This popover is where that gluing is
// approved: it names a sequence, glues it to the neighbour it touches or nearly
// touches, pulls it apart again, drags it to the current moment so it can be
// started early, and opens it in the tracker.

import { useEffect, useRef, useState } from 'react';
import type { Chain } from './schedule';
import { clockTime, compactDur } from './format';
import type { DialogAnchor } from './TaskDialog';
import {
  makeSequenceGradient,
  randomSequenceGradient,
  SEQUENCE_GRADIENT_PRESETS,
  sequenceGradientColors,
  sequenceGradientForTasks,
} from './sequenceGradients';

interface SessionPopoverProps {
  chain: Chain;
  anchor: DialogAnchor;
  now: number;
  onGradientChange: (gradient: string) => void;
  // Neighbouring sequences close enough to be glued to this one, if any.
  glueBefore: Chain | null;
  glueAfter: Chain | null;
  onRename: (name: string) => void;
  onMakeSession: () => void;
  onDissolve: () => void;
  onGlue: (before: Chain, after: Chain) => void;
  onStartNow: () => void;
  onOpen: () => void;
  onClose: () => void;
}

const POP_WIDTH = 300;
const POP_MARGIN = 12;

// A neighbour can now also be touching exactly — back-to-back blocks no longer
// glue themselves, so they are offered here like any other close pair.
function gapLabel(gapMs: number): string {
  return gapMs <= 0 ? 'подряд' : compactDur(gapMs / 1000);
}

function SessionPopover({
  chain,
  anchor,
  now,
  onGradientChange,
  glueBefore,
  glueAfter,
  onRename,
  onMakeSession,
  onDissolve,
  onGlue,
  onStartNow,
  onOpen,
  onClose,
}: SessionPopoverProps) {
  const [name, setName] = useState(chain.name ?? '');
  const boxRef = useRef<HTMLDivElement>(null);
  const gradient = sequenceGradientForTasks(chain.tasks, chain.sessionId ?? chain.id);
  const [gradientStart, setGradientStart] = useState(() => sequenceGradientColors(gradient)[0]);
  const [gradientEnd, setGradientEnd] = useState(() => sequenceGradientColors(gradient)[1]);
  const [sequenceAccent] = sequenceGradientColors(gradient);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);


  useEffect(() => {
    const [start, end] = sequenceGradientColors(gradient);
    setGradientStart(start);
    setGradientEnd(end);
  }, [gradient]);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left =
    anchor.x + POP_MARGIN + POP_WIDTH <= vw - POP_MARGIN
      ? anchor.x + POP_MARGIN
      : Math.max(POP_MARGIN, anchor.x - POP_MARGIN - POP_WIDTH);
  const top = Math.max(POP_MARGIN, Math.min(anchor.y - 30, vh - 480));

  const plannedSec = chain.tasks.reduce((sum, t) => sum + Math.max(0, t.plannedTime), 0);
  const started = now >= chain.startMs;
  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed !== (chain.name ?? '')) onRename(trimmed);
  };

  return (
    <div className="cal-modal-backdrop cal-modal-backdrop--pop" onMouseDown={onClose}>
      <div
        ref={boxRef}
        className="cal-session-pop"
        style={{
          left,
          top,
          width: POP_WIDTH,
          '--sequence-gradient': gradient,
          '--sequence-accent': sequenceAccent,
        } as React.CSSProperties}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cal-session-head">
          <span className="cal-session-badge">{chain.sessionId ? '🔗 Сессия' : '⛓ Секвенция'}</span>
          <button type="button" className="cal-modal-close" onClick={onClose} title="Закрыть">
            ✕
          </button>
        </header>

        <input
          className="cal-modal-name"
          value={name}
          placeholder="Название сессии"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitName();
            }
          }}
        />

        <p className="cal-session-when">
          {clockTime(chain.startMs)}–{clockTime(chain.endMs)} · {chain.tasks.length} задач ·{' '}
          {compactDur(plannedSec)}
        </p>

        <section className="cal-session-gradient" aria-label="Градиент секвенции">
          <div className="cal-session-gradient-head">
            <span>Градиент секвенции</span>
            <button
              type="button"
              className="cal-session-gradient-random"
              onClick={() => onGradientChange(randomSequenceGradient(gradient))}
            >
              🎲 Случайный
            </button>
          </div>
          <div className="cal-session-gradient-presets">
            {SEQUENCE_GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`cal-session-gradient-preset${preset.value === gradient ? ' active' : ''}`}
                style={{ background: preset.value }}
                onClick={() => onGradientChange(preset.value)}
                title={preset.name}
                aria-label={`Градиент «${preset.name}»`}
                aria-pressed={preset.value === gradient}
              />
            ))}
          </div>
          <div className="cal-session-gradient-custom">
            <span>Свой</span>
            <label title="Первый цвет градиента">
              <input
                type="color"
                value={gradientStart}
                aria-label="Первый цвет градиента"
                onChange={(e) => {
                  const next = e.target.value;
                  setGradientStart(next);
                  onGradientChange(makeSequenceGradient(next, gradientEnd));
                }}
              />
            </label>
            <span>→</span>
            <label title="Второй цвет градиента">
              <input
                type="color"
                value={gradientEnd}
                aria-label="Второй цвет градиента"
                onChange={(e) => {
                  const next = e.target.value;
                  setGradientEnd(next);
                  onGradientChange(makeSequenceGradient(gradientStart, next));
                }}
              />
            </label>
          </div>
        </section>

        <div className="cal-session-actions">
          <button type="button" className="cal-btn cal-btn--primary" onClick={onStartNow}>
            ▶ {started ? 'Перенести на сейчас' : 'Начать сейчас'}
          </button>
          <button type="button" className="cal-btn" onClick={onOpen}>
            ⏱ Открыть в трекере
          </button>
          {chain.sessionId === null ? (
            <button type="button" className="cal-btn" onClick={onMakeSession}>
              🔗 Объединить в сессию
            </button>
          ) : (
            <button type="button" className="cal-btn" onClick={onDissolve}>
              ✂ Разъединить
            </button>
          )}
          {glueBefore && (
            <button type="button" className="cal-btn" onClick={() => onGlue(glueBefore, chain)}>
              ⬆ Склеить с предыдущей ({gapLabel(chain.startMs - glueBefore.endMs)})
            </button>
          )}
          {glueAfter && (
            <button type="button" className="cal-btn" onClick={() => onGlue(chain, glueAfter)}>
              ⬇ Склеить со следующей ({gapLabel(glueAfter.startMs - chain.endMs)})
            </button>
          )}
        </div>

        <p className="cal-session-hint">
          Сессию можно тянуть за полоску слева — задачи переедут вместе, сохранив промежутки.
        </p>
      </div>
    </div>
  );
}

export default SessionPopover;
