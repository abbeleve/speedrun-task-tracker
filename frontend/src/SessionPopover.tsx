// Editor for one session — a run of blocks the calendar treats as a whole.
//
// A session is either *implicit* (blocks that simply follow each other with no
// gap) or *explicit* (blocks glued by hand, which then hold together whatever
// the gaps inside them are, move as one and carry a name). This popover is
// where the two are told apart: it names a sequence, glues it to the neighbour
// it nearly touches, pulls it apart again, drags it to the current moment so it
// can be started early, and opens it in the tracker.

import { useEffect, useRef, useState } from 'react';
import type { Chain } from './schedule';
import { clockTime, compactDur } from './format';
import type { DialogAnchor } from './TaskDialog';

interface SessionPopoverProps {
  chain: Chain;
  anchor: DialogAnchor;
  now: number;
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

function SessionPopover({
  chain,
  anchor,
  now,
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left =
    anchor.x + POP_MARGIN + POP_WIDTH <= vw - POP_MARGIN
      ? anchor.x + POP_MARGIN
      : Math.max(POP_MARGIN, anchor.x - POP_MARGIN - POP_WIDTH);
  const top = Math.max(POP_MARGIN, Math.min(anchor.y - 30, vh - 260));

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
        style={{ left, top, width: POP_WIDTH }}
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
              ⬆ Склеить с предыдущей ({compactDur((chain.startMs - glueBefore.endMs) / 1000)})
            </button>
          )}
          {glueAfter && (
            <button type="button" className="cal-btn" onClick={() => onGlue(chain, glueAfter)}>
              ⬇ Склеить со следующей ({compactDur((glueAfter.startMs - chain.endMs) / 1000)})
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
