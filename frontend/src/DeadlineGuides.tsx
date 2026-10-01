import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Task } from './types';

export default function DeadlineGuides({ deadlineId, tasks, scroller, flags, across }: {
  deadlineId: string | null; tasks: Task[]; scroller: RefObject<HTMLDivElement | null>;
  flags: RefObject<Map<string, HTMLButtonElement>>; across: boolean;
}) {
  const [drawing, setDrawing] = useState<{ left: number; top: number; width: number; height: number; paths: string[] } | null>(null);
  useLayoutEffect(() => {
    const sheet = scroller.current;
    if (!sheet || !deadlineId) return;
    const measure = () => {
      const bounds = sheet.getBoundingClientRect();
      const flag = flags.current.get(deadlineId);
      const target = flag?.getBoundingClientRect();
      const visible = (rect: DOMRect) => rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
      const linked = new Set(tasks.filter((task) => task.deadlineId === deadlineId).map((task) => task.id));
      const paths: string[] = [];
      if (target && visible(target)) {
        const edge = flag?.dataset.deadlineEdge;
        const tx = (across && edge === 'at-start' ? target.left : across && edge === 'at-end' ? target.right : (target.left + target.right) / 2) - bounds.left;
        const ty = (!across && edge === 'at-start' ? target.top : !across && edge === 'at-end' ? target.bottom : (target.top + target.bottom) / 2) - bounds.top;
        sheet.querySelectorAll<HTMLElement>('.cal-block[data-task-end="true"]').forEach((element) => {
          if (!linked.has(element.dataset.taskId ?? '')) return;
          const rect = element.getBoundingClientRect();
          if (!visible(rect)) return;
          const sx = (across ? rect.right : (rect.left + rect.right) / 2) - bounds.left;
          const sy = (across ? (rect.top + rect.bottom) / 2 : rect.bottom) - bounds.top;
          paths.push(across ? `M ${sx} ${sy} H ${tx} V ${ty}` : `M ${sx} ${sy} V ${ty} H ${tx}`);
        });
      }
      setDrawing({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, paths });
    };
    measure();
    sheet.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { sheet.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [deadlineId, tasks, scroller, flags, across]);
  if (!deadlineId || !drawing?.paths.length) return null;
  return <svg className="cal-deadline-guides" aria-hidden="true" width={drawing.width} height={drawing.height} style={{ left: drawing.left, top: drawing.top }}>
    {drawing.paths.map((path, index) => <path key={index} d={path} />)}
  </svg>;
}
