import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Deadline, Task } from './types';
import { deadlineLabel, deadlineState, openDeadlines } from './deadlines';
import { isDone } from './schedule';
import { IconFlag } from './icons';

// These dialogs can open above the work-block editor. Capture Escape and trap
// focus in the top dialog, then restore the block editor's focus on dismissal.
function useModal(ref: RefObject<HTMLElement | null>, onClose: () => void, busy = false) {
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => [...(ref.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'
    ) ?? [])];
    (ref.current?.querySelector<HTMLInputElement>('input') ?? controls()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      } else if (event.key === 'Tab') {
        const items = controls();
        const first = items[0], last = items.at(-1);
        if (!first || !last) return;
        if (!ref.current?.contains(document.activeElement)) {
          event.preventDefault(); first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [ref]);
}

export function DeadlineList({ deadlines, now, onOpen, onCreate, onClose }: {
  deadlines: Deadline[]; now: number; onOpen: (deadline: Deadline) => void;
  onCreate: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  const sorted = [...openDeadlines(deadlines), ...deadlines.filter((item) => item.completedAt !== null)];
  return <div className="cal-modal-backdrop cal-deadline-backdrop" onMouseDown={onClose}>
    <div ref={ref} className="cal-modal cal-deadline-modal" role="dialog" aria-modal="true" aria-label="Дедлайны" onMouseDown={(event) => event.stopPropagation()}>
      <header className="cal-modal-head"><IconFlag /><h3>Дедлайны</h3><button type="button" className="cal-modal-close" aria-label="Закрыть" onClick={onClose}>✕</button></header>
      <div className="cal-deadline-list">
        {sorted.map((deadline) => <button type="button" key={deadline.id} className={`cal-deadline-list-item ${deadlineState(deadline, now)}`} onClick={() => onOpen(deadline)}>
          <IconFlag size={16} /><span><strong>{deadline.name}</strong><small>{deadlineLabel(deadline)}</small></span><span>{deadline.completedAt !== null ? '✓ Закрыт' : deadlineState(deadline, now) === 'overdue' ? 'Просрочен' : 'Открыт'}</span>
        </button>)}
        {sorted.length === 0 && <p className="cal-session-hint">Создай дедлайн и свяжи с ним рабочие блоки на нужные дни.</p>}
      </div>
      <footer className="cal-deadline-actions"><button type="button" className="cal-btn" onClick={onCreate}>＋ Новый дедлайн</button></footer>
    </div>
  </div>;
}

export default function DeadlineDialog({ deadline, isNew, tasks, now, onSave, onDelete, onOpenTask, onAddTask, onClose }: {
  deadline: Deadline; isNew: boolean; tasks: Task[]; now: number;
  onSave: (deadline: Deadline) => Promise<void>; onDelete: () => Promise<void>;
  onOpenTask: (task: Task) => void; onAddTask: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(deadline.name);
  const [description, setDescription] = useState(deadline.description ?? '');
  const [day, setDay] = useState(deadline.dueDay);
  const [timed, setTimed] = useState(deadline.dueTime !== null);
  const [time, setTime] = useState(deadline.dueTime === null ? '18:00' : `${String(Math.floor(deadline.dueTime / 60)).padStart(2, '0')}:${String(deadline.dueTime % 60).padStart(2, '0')}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModal(ref, onClose, busy);
  const linked = tasks.filter((task) => task.deadlineId === deadline.id)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.start ?? 0) - (b.start ?? 0));
  const complete = linked.filter(isDone).length;
  const persist = async (completedAt: number | null) => {
    if (busy || !ref.current?.reportValidity()) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Укажи название дедлайна'); return; }
    const [hours, minutes] = time.split(':').map(Number);
    setBusy(true); setError(null);
    try {
      await onSave({ ...deadline, name: trimmed, description: description.trim() || null, dueDay: day, dueTime: timed ? hours * 60 + minutes : null, completedAt });
      onClose();
    } catch {
      setError('Не удалось сохранить дедлайн. Изменения ещё не сохранены.');
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onDelete(); onClose(); }
    catch { setError('Не удалось удалить дедлайн'); }
    finally { setBusy(false); }
  };
  return <div className="cal-modal-backdrop cal-deadline-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <form ref={ref} className="cal-modal cal-deadline-modal" role="dialog" aria-modal="true" aria-label={isNew ? 'Новый дедлайн' : 'Редактор дедлайна'} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void persist(deadline.completedAt); }}>
      <header className="cal-modal-head"><IconFlag /><h3>{isNew ? 'Новый дедлайн' : 'Дедлайн'}</h3><button type="button" className="cal-modal-close" aria-label="Закрыть" disabled={busy} onClick={onClose}>✕</button></header>
      <fieldset disabled={busy} className="cal-deadline-fields">
        <label className="cal-field"><span>Название результата</span><input value={name} maxLength={200} required onChange={(event) => setName(event.target.value)} /></label>
        <label className="cal-field"><span>Описание</span><textarea value={description} rows={2} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="cal-modal-row"><label className="cal-field cal-field--grow"><span>Срок</span><input type="date" value={day} required onChange={(event) => setDay(event.target.value)} /></label>{timed && <label className="cal-field"><span>Время</span><input type="time" value={time} required onChange={(event) => setTime(event.target.value)} /></label>}</div>
        <label className="cal-check"><input type="checkbox" checked={timed} onChange={(event) => setTimed(event.target.checked)} /><span>Указать время</span></label>
        {!isNew && <><p className={`cal-deadline-status ${deadlineState(deadline, now)}`}>{deadline.completedAt !== null ? '✓ Дедлайн закрыт' : deadlineState(deadline, now) === 'overdue' ? 'Просрочен · дедлайн остаётся открытым' : 'Дедлайн открыт'}</p>
          <div className="cal-deadline-linked"><h4>Рабочие блоки · {complete} из {linked.length} закрыто</h4>{linked.map((task) => <button type="button" key={task.id} className="cal-deadline-linked-task" onClick={() => onOpenTask(task)}><span>{isDone(task) ? '✓' : '○'} {task.emoji} {task.name}</span><small>{task.day}</small></button>)}
            {linked.length > 0 && complete === linked.length && deadline.completedAt === null && <p className="cal-session-hint">Рабочие блоки закрыты · дедлайн ещё открыт</p>}
            <button type="button" className="cal-btn" onClick={onAddTask}>＋ Запланировать блок</button>
          </div></>}
      </fieldset>
      {error && <p className="cal-template-error" role="alert">{error}</p>}
      <footer className="cal-deadline-actions">
        {!isNew && <button type="button" className="cal-btn cal-btn--danger" disabled={busy} onClick={() => { void remove(); }}>Удалить дедлайн</button>}
        <button type="submit" className="cal-btn" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
        {!isNew && <button type="button" className="cal-btn cal-btn--primary" disabled={busy} onClick={() => { void persist(deadline.completedAt === null ? now : null); }}>{deadline.completedAt === null ? '✓ Закрыть дедлайн' : 'Открыть снова'}</button>}
      </footer>
    </form>
  </div>;
}
