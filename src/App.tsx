import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task, Template, TaskTemplate, TaskType } from './types';
import { DEFAULT_EMOJI, DEFAULT_COLOR, TASK_COLORS, TASK_EMOJIS, ALL_EMOJIS, EMOJI_DATA } from './types';
import { useTimer, formatTime, formatDelta } from './useTimer';
import './App.css';

let nextId = 1;
const uid = () => `t-${nextId++}-${Date.now()}`;

const PRESETS: { name: string; plannedTime: number }[] = [
  { name: 'Setup', plannedTime: 120 },
  { name: 'Planning', plannedTime: 300 },
  { name: 'Development', plannedTime: 1800 },
  { name: 'Testing', plannedTime: 600 },
  { name: 'Review', plannedTime: 300 },
  { name: 'Deploy', plannedTime: 180 },
];

const MIN_BLOCK_PX = 72;
const MAX_BLOCK_PX = 200;

function App() {
  // ── Pick ruler interval so labels don't overlap ──
  // targetPx: minimum pixel gap between consecutive marks
  function pickInterval(totalSec: number, totalPx: number, targetPx = 32): number {
    if (totalPx <= 0 || totalSec <= 0) return 300;
    const pxPerSec = totalPx / totalSec;
    const targetSec = Math.ceil(targetPx / pxPerSec);
    const nice = [15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600];
    for (const iv of nice) {
      if (iv >= targetSec) return iv;
    }
    return 3600;
  }

  const [tasks, setTasks] = useState<Task[]>([]);
  const [newName, setNewName] = useState('');
  const [newMinutes, setNewMinutes] = useState('5');
  const [newEmoji, setNewEmoji] = useState(DEFAULT_EMOJI);
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [showEmojiPopup, setShowEmojiPopup] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [showPresets, setShowPresets] = useState(true);
  const [savedTemplates, setSavedTemplates] = useState<Template[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [timeCredit, setTimeCredit] = useState(0);
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
  const [editTimeStr, setEditTimeStr] = useState('');
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameStr, setEditNameStr] = useState('');
  const [editingEmojiId, setEditingEmojiId] = useState<string | null>(null);
  const [emojiEditSearch, setEmojiEditSearch] = useState('');
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [jumpStr, setJumpStr] = useState('');
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const pauseStartRef = useRef<number | null>(null);
  const [congrats, setCongrats] = useState<{ id: string; name: string } | null>(null);
  const congratsTimerRef = useRef<number | null>(null);
  const [glow, setGlow] = useState<{ id: string; color: string } | null>(null);
  const glowTimerRef = useRef<number | null>(null);
  const prevTaskIdRef = useRef<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplMinutes, setTplMinutes] = useState('5');
  const [tplEmoji, setTplEmoji] = useState(DEFAULT_EMOJI);
  const [tplColor, setTplColor] = useState(DEFAULT_COLOR);
  const [tplType, setTplType] = useState<TaskType>('task');
  const [showTplEmojiPopup, setShowTplEmojiPopup] = useState(false);
  const [tplEmojiSearch, setTplEmojiSearch] = useState("");
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('speedrun_theme');
    return saved !== null ? saved === 'dark' : true;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    localStorage.setItem('speedrun_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Escape always closes any open dialog/overlay so the app can't get stuck
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setEditingEmojiId(null);
      setEmojiEditSearch('');
      setEditingColorId(null);
      setShowSaveTpl(false);
      setShowEmojiPopup(false);
      setShowTplEmojiPopup(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const { elapsed, sessionState, start, pause, resume, reset, finish, seek } = useTimer();
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const pauseRef = useRef(pause);
  pauseRef.current = pause;

  useEffect(() => {
    const stored = localStorage.getItem('speedrun_templates');
    if (stored) {
      try {
        setSavedTemplates(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load templates', e);
      }
    }
    const storedTpl = localStorage.getItem('speedrun_task_templates');
    if (storedTpl) {
      try { setTaskTemplates(JSON.parse(storedTpl)); } catch {}
    }
  }, []);

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => a.order - b.order), [tasks]);
  const sessionElapsedSec = elapsed / 1000;

  const filteredEmojis = useMemo(() => {
    if (!emojiSearch.trim()) return ALL_EMOJIS;
    const q = emojiSearch.toLowerCase();
    return EMOJI_DATA.filter(e => e.keywords.some(k => k.includes(q)) || e.emoji === q).map(e => e.emoji);
  }, [emojiSearch]);

  const filteredTplEmojis = useMemo(() => {
    if (!tplEmojiSearch.trim()) return ALL_EMOJIS;
    const q = tplEmojiSearch.toLowerCase();
    return EMOJI_DATA.filter(e => e.keywords.some(k => k.includes(q)) || e.emoji === q).map(e => e.emoji);
  }, [tplEmojiSearch]);

  const filteredEditEmojis = useMemo(() => {
    if (!emojiEditSearch.trim()) return ALL_EMOJIS;
    const q = emojiEditSearch.toLowerCase();
    return EMOJI_DATA.filter(e => e.keywords.some(k => k.includes(q)) || e.emoji === q).map(e => e.emoji);
  }, [emojiEditSearch]);

  const editingEmojiTask = useMemo(
    () => tasks.find(t => t.id === editingEmojiId) ?? null,
    [tasks, editingEmojiId]
  );

  const editingColorTask = useMemo(
    () => tasks.find(t => t.id === editingColorId) ?? null,
    [tasks, editingColorId]
  );

  const cumulativeTimes = useMemo(() => {
    const arr: number[] = [];
    let cum = 0;
    for (const t of sortedTasks) {
      arr.push(cum);
      cum += t.plannedTime;
    }
    return arr;
  }, [sortedTasks]);

  const totalPlannedSec = useMemo(
    () => sortedTasks.reduce((s, t) => s + t.plannedTime, 0),
    [sortedTasks]
  );

  const maxPlannedSec = useMemo(
    () => sortedTasks.reduce((max, t) => Math.max(max, t.plannedTime), 0),
    [sortedTasks]
  );

  const blockHeight = useCallback(
    (plannedTime: number) => {
      if (maxPlannedSec <= 0) return MIN_BLOCK_PX;
      const proportion = plannedTime / maxPlannedSec;
      return MIN_BLOCK_PX + (MAX_BLOCK_PX - MIN_BLOCK_PX) * Math.sqrt(proportion);
    },
    [maxPlannedSec]
  );

  const timelineHeight = useMemo(() => {
    return sortedTasks.reduce((sum, t) => sum + blockHeight(t.plannedTime), 0);
  }, [sortedTasks, blockHeight]);

  // Pixels → time converter for scrubbing (stable ref, refreshed each render)
  const calcTimeFromPxRef = useRef<(px: number) => number>(() => 0);
  calcTimeFromPxRef.current = (px: number) => {
    let remaining = Math.max(0, Math.min(px, timelineHeight));
    let time = 0;
    for (let i = 0; i < sortedTasks.length; i++) {
      const t = sortedTasks[i];
      const bH = blockHeight(t.plannedTime);
      if (remaining <= bH) {
        time += (remaining / bH) * t.plannedTime;
        break;
      }
      remaining -= bH;
      time += t.plannedTime;
    }
    return Math.min(time, totalPlannedSec);
  };

  const taskLayout = useMemo(() => {
    const layout: { offset: number; height: number }[] = [];
    let offset = 0;
    for (const t of sortedTasks) {
      const h = blockHeight(t.plannedTime);
      layout.push({ offset, height: h });
      offset += h;
    }
    return layout;
  }, [sortedTasks, blockHeight]);

  const currentTaskIdx = useMemo(
    () => sortedTasks.findIndex((t) => t.completedAt === null),
    [sortedTasks]
  );

  // Active task = first uncompleted one, so the color switches immediately when
  // a task is finished early (used for thermo/fill/glow color).
  const currentTask = useMemo(() => {
    if (sortedTasks.length === 0) return null;
    const idx = sortedTasks.findIndex((t) => t.completedAt === null);
    return idx >= 0 ? sortedTasks[idx] : sortedTasks[sortedTasks.length - 1];
  }, [sortedTasks]);

  // Flash the edge glow only when moving to another task
  useEffect(() => {
    const task = currentTask;
    const prevId = prevTaskIdRef.current;
    prevTaskIdRef.current = task?.id ?? null;
    if (!task || prevId === null || prevId === task.id) return;
    if (glowTimerRef.current !== null) window.clearTimeout(glowTimerRef.current);
    setGlow({ id: task.id, color: task.color });
    glowTimerRef.current = window.setTimeout(() => setGlow(null), 1800);
  }, [currentTask]);

  // Total work time left: planned time of uncompleted tasks minus time already
  // spent in the current task and minus banked credit
  const remainingWorkSec = useMemo(() => {
    const planned = sortedTasks.reduce(
      (s, t) => s + (t.completedAt === null ? t.plannedTime : 0),
      0
    );
    let taskStart = 0;
    for (const t of sortedTasks) {
      if (t.completedAt !== null && t.completedAt > taskStart) {
        taskStart = t.completedAt;
      }
    }
    const elapsedInTask = Math.max(0, sessionElapsedSec - taskStart);
    return Math.max(0, planned - elapsedInTask - timeCredit);
  }, [sortedTasks, sessionElapsedSec, timeCredit]);

  const calcPlayheadPx = useCallback(() => {
    let sec = sessionElapsedSec;
    let px = 0;
    for (let i = 0; i < sortedTasks.length; i++) {
      const t = sortedTasks[i];
      const bH = blockHeight(t.plannedTime);
      const secInBlock = t.plannedTime;
      if (sec <= secInBlock) {
        px += (sec / secInBlock) * bH;
        break;
      }
      sec -= secInBlock;
      px += bH;
    }
    return px;
  }, [sortedTasks, blockHeight, sessionElapsedSec]);

  // Pixel position of the playhead — used for both the playhead marker
  // and for determining which ruler marks are "filled" (passed).
  const playheadPx = useMemo(() => {
    if (sessionState !== 'running' && sessionState !== 'paused') return 0;
    return calcPlayheadPx();
  }, [sessionState, calcPlayheadPx]);

  useEffect(() => {
    if (sessionState !== 'running' && sessionState !== 'paused') return;
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateY(${playheadPx}px)`;
    }
    if (fillRef.current) {
      fillRef.current.style.height = `${playheadPx}px`;
    }
  }, [playheadPx, sessionState]);

  useEffect(() => {
    if (sessionState === 'idle' && fillRef.current) {
      fillRef.current.style.height = '0px';
    }
    if (sessionState === 'idle' && playheadRef.current) {
      playheadRef.current.style.transform = 'translateY(0px)';
    }
  }, [sessionState]);

  useEffect(() => {
    if (sessionState === 'running' && playheadRef.current) {
      playheadRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }, [currentTaskIdx, sessionState]);

  // Time scrubbing — drag on timeline tracks to seek
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;

    let scrubbing = false;

    const getTimeFromEvent = (e: MouseEvent): number => {
      const rect = container.getBoundingClientRect();
      const px = e.clientY - rect.top + container.scrollTop;
      return calcTimeFromPxRef.current(Math.max(0, px));
    };

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Only scrub when clicking on the thermo column
      if (!target.closest('.timeline-thermo')) return;
      if (sessionStateRef.current === 'idle') return;

      scrubbing = true;

      const time = getTimeFromEvent(e);
      seekRef.current(time * 1000);
      e.preventDefault();
      container.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!scrubbing) return;
      const time = getTimeFromEvent(e);
      seekRef.current(time * 1000);
    };

    const onMouseUp = () => {
      if (!scrubbing) return;
      scrubbing = false;
      container.style.cursor = '';
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const addTask = useCallback(
    (name: string, plannedTime: number, emoji: string, color: string, type: TaskType = 'task') => {
      if (!name.trim() || plannedTime <= 0) return;
      const task: Task = {
        id: uid(),
        name: name.trim(),
        plannedTime,
        completedAt: null,
        order: tasks.length,
        emoji: emoji || DEFAULT_EMOJI,
        color: color || DEFAULT_COLOR,
        type,
      };
      setTasks((prev) => [...prev, task]);
    },
    [tasks.length]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      addTask(newName, Math.max(1, Math.round(parseFloat(newMinutes) * 60)), newEmoji, newColor);
      setNewName('');
      setNewMinutes('5');
      setNewEmoji(DEFAULT_EMOJI);
      setNewColor(DEFAULT_COLOR);
    },
    [addTask, newName, newMinutes, newEmoji, newColor]
  );

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      return filtered.map((t, i) => ({ ...t, order: i }));
    });
  }, []);

  const clearAllTasks = useCallback(() => {
    setTasks([]);
    reset();
    setShowPresets(true);
    setTimeCredit(0);
  }, [reset]);

  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [saveTplName, setSaveTplName] = useState('');

  const saveTemplate = useCallback(() => {
    if (sortedTasks.length === 0) return;
    setSaveTplName('');
    setShowSaveTpl(true);
  }, [sortedTasks.length]);

  const confirmSaveTemplate = useCallback(() => {
    const templateName = saveTplName.trim();
    setShowSaveTpl(false);
    if (!templateName || sortedTasks.length === 0) return;

    const newTemplate: Template = {
      id: uid(),
      name: templateName,
      tasks: sortedTasks.map(t => ({ name: t.name, plannedTime: t.plannedTime, emoji: t.emoji, color: t.color, type: t.type })),
    };

    const updated = [...savedTemplates, newTemplate];
    setSavedTemplates(updated);
    localStorage.setItem('speedrun_templates', JSON.stringify(updated));
  }, [saveTplName, savedTemplates, sortedTasks]);

  const loadTemplate = useCallback((template: Template) => {
    reset();
    setSessionStartTime(null);
    setTimeCredit(0);
    const newTasks: Task[] = template.tasks.map((t, i) => ({
      id: uid(),
      name: t.name,
      plannedTime: t.plannedTime,
      completedAt: null,
      order: i,
      emoji: t.emoji || DEFAULT_EMOJI,
      color: t.color || DEFAULT_COLOR,
      type: t.type ?? 'task',
    }));
    setTasks(newTasks);
    setShowPresets(false);
  }, [reset]);

  const deleteTemplate = useCallback((id: string) => {
    const updated = savedTemplates.filter(t => t.id !== id);
    setSavedTemplates(updated);
    localStorage.setItem('speedrun_templates', JSON.stringify(updated));
  }, [savedTemplates]);

  const exportTemplates = useCallback(() => {
    if (savedTemplates.length === 0) return;
    const dataStr = JSON.stringify(savedTemplates, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'speedrun-templates.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  }, [savedTemplates]);

  const importTemplates = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string);
        if (Array.isArray(imported) && imported.every(t => t.name && t.tasks)) {
          const updated = [...savedTemplates, ...imported];
          // Deduplicate by name or ID if necessary, but for now simple merge
          setSavedTemplates(updated);
          localStorage.setItem('speedrun_templates', JSON.stringify(updated));
          alert('Templates imported successfully!');
        } else {
          alert('Invalid template file format.');
        }
      } catch (err) {
        alert('Error reading template file.');
      }
    };
    reader.readAsText(file);
  }, [savedTemplates]);

  const showCongrats = useCallback((name: string) => {
    if (congratsTimerRef.current !== null) {
      window.clearTimeout(congratsTimerRef.current);
    }
    setCongrats({ id: uid(), name });
    congratsTimerRef.current = window.setTimeout(() => setCongrats(null), 3000);
  }, []);

  const completeTask = useCallback(
    (id: string) => {
      if (sessionState !== 'running') return;

      // Check if completing a future task (there are uncompleted tasks before it)
      const sorted = [...tasks].sort((a, b) => a.order - b.order);
      const taskIdx = sorted.findIndex((t) => t.id === id);
      if (taskIdx === -1) return;
      const task = sorted[taskIdx];
      const firstUncompletedIdx = sorted.findIndex((t) => t.completedAt === null);

      if (firstUncompletedIdx >= 0 && firstUncompletedIdx < taskIdx) {
        // Completing a future task early — add saved time as credit
        let plannedStart = 0;
        for (let i = 0; i < taskIdx; i++) {
          plannedStart += sorted[i].plannedTime;
        }
        const plannedEnd = plannedStart + sorted[taskIdx].plannedTime;
        const timeSaved = plannedEnd - sessionElapsedSec;

        setTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, completedAt: sessionElapsedSec } : t))
        );

        if (timeSaved > 0) {
          setTimeCredit((prev) => prev + timeSaved);
        }
        if (task.type !== 'rest') showCongrats(task.name);
        return;
      }

      // Normal completion
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completedAt: sessionElapsedSec } : t))
      );
      if (task.type !== 'rest') showCongrats(task.name);
    },
    [sessionState, sessionElapsedSec, tasks, showCongrats]
  );

  const uncompleteTask = useCallback((id: string) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id);
      if (!task || task.completedAt === null) return prev;

      // If this was a future completion, subtract its timeSaved from credit
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const taskIdx = sorted.findIndex((t) => t.id === id);
      const hasUncompletedBefore = sorted.slice(0, taskIdx).some((t) => t.completedAt === null);

      if (hasUncompletedBefore && task.completedAt !== null) {
        let plannedStart = 0;
        for (let i = 0; i < taskIdx; i++) {
          plannedStart += sorted[i].plannedTime;
        }
        const plannedEnd = plannedStart + task.plannedTime;
        const timeSaved = plannedEnd - task.completedAt;
        if (timeSaved > 0) {
          setTimeCredit((c) => Math.max(0, c - timeSaved));
        }
      }

      return prev.map((t) => (t.id === id ? { ...t, completedAt: null } : t));
    });
  }, []);

  const copyTask = useCallback((id: string) => {
    setTasks((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const sourceIdx = sorted.findIndex((t) => t.id === id);
      if (sourceIdx < 0) return prev;
      const source = sorted[sourceIdx];
      const copy: Task = {
        id: uid(),
        name: source.name + ' (copy)',
        plannedTime: source.plannedTime,
        completedAt: null,
        order: source.order + 1,
        emoji: source.emoji,
        color: source.color,
        type: source.type,
      };
      const result: Task[] = [];
      for (let i = 0; i < sorted.length; i++) {
        result.push(sorted[i]);
        if (i === sourceIdx) {
          result.push(copy);
        }
      }
      return result.map((t, i) => ({ ...t, order: i }));
    });
  }, []);

  const startEditName = useCallback((id: string, name: string) => {
    setEditingNameId(id);
    setEditNameStr(name);
  }, []);

  const commitEditName = useCallback((id: string) => {
    const trimmed = editNameStr.trim();
    if (trimmed) {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, name: trimmed } : t));
    }
    setEditingNameId(null);
    setEditNameStr('');
  }, [editNameStr]);

  const changeTaskEmoji = useCallback((id: string, emoji: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, emoji } : t));
    setEditingEmojiId(null);
    setEmojiEditSearch('');
  }, []);

  const changeTaskColor = useCallback((id: string, color: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, color } : t));
    setEditingColorId(null);
  }, []);

  const moveTask = useCallback((fromIdx: number, toIdx: number) => {
    setTasks((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const [moved] = sorted.splice(fromIdx, 1);
      sorted.splice(toIdx, 0, moved);
      return sorted.map((t, i) => ({ ...t, order: i }));
    });
  }, []);

  // --- Task resize: drag bottom edge to change planned time ---
  const resizeRef = useRef<{ id: string; startY: number; startH: number; maxPlanned: number } | null>(null);

  const startEditTime = useCallback((id: string, plannedTime: number) => {
    setEditingTimeId(id);
    const totalSec = plannedTime;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      setEditTimeStr(`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    } else {
      setEditTimeStr(`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    }
  }, []);

  const commitEditTime = useCallback((id: string) => {
    const parts = editTimeStr.split(':').map(p => parseInt(p) || 0);
    let totalSec = 0;
    if (parts.length === 3) {
      totalSec = Math.min(parts[0], 99) * 3600 + Math.min(parts[1], 59) * 60 + Math.min(parts[2], 59);
    } else if (parts.length === 2) {
      totalSec = Math.min(parts[0], 99) * 60 + Math.min(parts[1], 59);
    } else {
      totalSec = Math.max(1, Math.round(parseFloat(editTimeStr) * 60));
    }
    if (totalSec > 0) {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, plannedTime: totalSec } : t));
    }
    setEditingTimeId(null);
  }, [editTimeStr]);

  const handleJump = useCallback(() => {
    const val = jumpStr.trim();
    if (!val) return;
    let offsetMin = parseFloat(val);
    if (!isNaN(offsetMin)) {
      const offsetMs = Math.round(offsetMin * 60 * 1000);
      seek(Math.max(0, elapsed + offsetMs));
    }
    setJumpStr('');
  }, [jumpStr, seek, elapsed]);

  const saveTaskTemplates = useCallback((tpls: TaskTemplate[]) => {
    localStorage.setItem('speedrun_task_templates', JSON.stringify(tpls));
  }, []);

  const addTaskTemplate = useCallback(() => {
    if (!tplName.trim()) return;
    const tpl: TaskTemplate = {
      id: uid(), name: tplName.trim(),
      plannedTime: Math.max(1, Math.round(parseFloat(tplMinutes) * 60)),
      emoji: tplEmoji, color: tplColor, type: tplType,
    };
    const updated = [...taskTemplates, tpl];
    setTaskTemplates(updated);
    saveTaskTemplates(updated);
    setTplName(''); setTplMinutes('5'); setTplEmoji(DEFAULT_EMOJI); setTplColor(DEFAULT_COLOR); setTplType('task');
  }, [tplName, tplMinutes, tplEmoji, tplColor, tplType, taskTemplates, saveTaskTemplates]);

  const deleteTaskTemplate = useCallback((id: string) => {
    const updated = taskTemplates.filter(t => t.id !== id);
    setTaskTemplates(updated);
    saveTaskTemplates(updated);
  }, [taskTemplates, saveTaskTemplates]);

  const addTaskFromTemplate = useCallback((tpl: TaskTemplate) => {
    const task: Task = {
      id: uid(), name: tpl.name, plannedTime: tpl.plannedTime,
      completedAt: null, order: tasks.length, emoji: tpl.emoji, color: tpl.color,
      type: tpl.type ?? 'task',
    };
    setTasks(prev => [...prev, task]);
  }, [tasks.length]);

  const handleTimelineDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const tpl = taskTemplates.find(t => t.id === id);
    if (tpl) addTaskFromTemplate(tpl);
  }, [taskTemplates, addTaskFromTemplate]);

  const handleTimelineDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const splitTask = useCallback(() => {
    if (sessionState !== 'paused' && sessionState !== 'idle') return;
    const idx = sortedTasks.findIndex(t => t.completedAt === null);
    if (idx < 0) return;
    const task = sortedTasks[idx];
    const taskStart = sortedTasks.slice(0, idx).reduce((max, t) => Math.max(max, t.completedAt ?? 0), 0);
    const elapsed = Math.max(1, Math.round(sessionElapsedSec - taskStart));
    const remaining = Math.max(1, task.plannedTime - elapsed);
    if (remaining <= 0 || elapsed <= 0) return;

    setTasks(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      // Create first half (completed)
      const firstHalf: Task = {
        id: uid(), name: task.name + ' (1/2)',
        plannedTime: elapsed, completedAt: sessionElapsedSec, order: task.order,
        emoji: task.emoji, color: task.color, type: task.type,
      };
      // Update second half (remaining, stays current)
      const newTasks = sorted.map(t => {
        if (t.id === task.id) {
          return { ...t, name: task.name + ' (2/2)', plannedTime: remaining, completedAt: null };
        }
        // Shift subsequent tasks' order up by 1
        if (t.order > task.order) return { ...t, order: t.order + 1 };
        return t;
      });
      // Insert first half before second half
      newTasks.splice(idx, 0, firstHalf);
      return newTasks.map((t, i) => ({ ...t, order: i }));
    });
  }, [sortedTasks, sessionElapsedSec, sessionState]);

  const handleResizeStart = useCallback((e: React.MouseEvent, id: string, currentHeight: number) => {
    e.preventDefault();
    e.stopPropagation();
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    resizeRef.current = { id, startY: e.clientY, startH: currentHeight, maxPlanned: maxPlannedSec || task.plannedTime };
  }, [tasks, maxPlannedSec]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const r = resizeRef.current;
      const dy = e.clientY - r.startY;
      const newH = Math.max(MIN_BLOCK_PX, r.startH + dy);
      const ratio = (newH - MIN_BLOCK_PX) / (MAX_BLOCK_PX - MIN_BLOCK_PX);
      const proportion = Math.max(0.01, ratio * ratio);
      const newTime = Math.max(1, Math.round(proportion * r.maxPlanned));
      setTasks(prev => prev.map(t => (t.id === r.id ? { ...t, plannedTime: newTime } : t)));
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const loadPresets = useCallback(() => {
    setTasks([]);
    setTimeCredit(0);
    const pts = PRESETS.map((p, i) => ({
      id: uid(),
      name: p.name,
      plannedTime: p.plannedTime,
      completedAt: null,
      order: i,
      emoji: TASK_EMOJIS[i % TASK_EMOJIS.length],
      color: TASK_COLORS[i % TASK_COLORS.length],
      type: 'task' as TaskType,
    }));
    setTasks(pts);
    setShowPresets(false);
  }, []);

  const handleReset = useCallback(() => {
    reset();
    setTasks((prev) => prev.map((t) => ({ ...t, completedAt: null })));
    setSessionStartTime(null);
    setTimeCredit(0);
    pauseStartRef.current = null;
  }, [reset]);

  const handleSessionAction = useCallback(() => {
    if (sessionState === 'idle') {
      if (sortedTasks.length === 0) return;
      setSessionStartTime(Date.now());
      setTimeCredit(0);
      pauseStartRef.current = null;
      start();
    } else if (sessionState === 'running') {
      pauseStartRef.current = Date.now();
      pause();
    } else if (sessionState === 'paused') {
      pauseStartRef.current = null;
      resume();
    }
  }, [sessionState, sortedTasks.length, start, pause, resume]);

  const allCompleted = sortedTasks.length > 0 && sortedTasks.every((t) => t.completedAt !== null);

  useEffect(() => {
    if (allCompleted && sessionState === 'running') {
      finish();
    }
  }, [allCompleted, sessionState, finish]);

  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    // Sidebar template drags have no source index — skip reorder state entirely
    if (dragIdx === null) return;
    // Only re-render when the hovered block actually changes
    setDragOverIdx(prev => (prev === idx ? prev : idx));
  };
  const onDrop = (toIdx: number) => {
    if (dragIdx !== null && dragIdx !== toIdx) {
      moveTask(dragIdx, toIdx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const onDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const formatWallTime = (ms: number) => {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const formatRealTime = (secondsFromStart: number) => {
    const base = sessionStartTime ?? Date.now();
    const d = new Date(base + secondsFromStart * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const rulerMarks = useMemo(() => {
    if (totalPlannedSec <= 0 || sortedTasks.length === 0) return [];
    const marks: { sec: number; label: string; px: number }[] = [];
    const interval = pickInterval(totalPlannedSec, timelineHeight, 40);

    let nextMark = interval;
    let secAccum = 0;
    let pxAccum = 0;
    for (let i = 0; i < sortedTasks.length; i++) {
      const t = sortedTasks[i];
      const bH = blockHeight(t.plannedTime);
      const blockSec = t.plannedTime;
      while (nextMark <= secAccum + blockSec) {
        const secIntoBlock = nextMark - secAccum;
        const pxIntoBlock = (secIntoBlock / blockSec) * bH;
        marks.push({
          sec: nextMark,
          label: formatTime(nextMark * 1000, false),
          px: pxAccum + pxIntoBlock,
        });
        nextMark += interval;
      }
      secAccum += blockSec;
      pxAccum += bH;
    }
    return marks;
  }, [sortedTasks, totalPlannedSec, blockHeight]);

  const showPlayhead = sessionState === 'running' || sessionState === 'paused';

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span className="icon">⏱</span> SpeedRun Tasks
        </h1>
        <button
          className="theme-toggle"
          onClick={() => setDarkMode(!darkMode)}
          title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {darkMode ? '☀️' : '🌙'}
          <span className="theme-toggle-label">{darkMode ? 'Light' : 'Dark'}</span>
        </button>
        <button
          className="btn btn-sidebar"
          onClick={() => setShowSidebar(!showSidebar)}
          title="Task Templates"
        >
          📋 {showSidebar ? 'Hide' : 'Templates'}
        </button>
        <div className="session-controls">
          {sessionState === 'idle' && (
            <>
              <button
                className="btn btn-start"
                onClick={handleSessionAction}
                disabled={sortedTasks.length === 0}
              >
                ▶ Start Run
              </button>
              {sortedTasks.length > 0 && (
                <>
                  <button
                    className="btn btn-save-template"
                    onClick={saveTemplate}
                    title="Save current tasks as template"
                  >
                    💾 Save Template
                  </button>
                  <button className="btn btn-clear" onClick={clearAllTasks} title="Remove all tasks">
                    🗑 Clear All
                  </button>
                </>
              )}
            </>
          )}
          {sessionState === 'running' && (
            <button className="btn btn-pause" onClick={handleSessionAction}>
              ⏸ Pause
            </button>
          )}
          {sessionState === 'paused' && (
            <>
              <button className="btn btn-resume" onClick={handleSessionAction}>
                ▶ Resume
              </button>
              <button className="btn btn-reset" onClick={handleReset}>
                ↺ Reset
              </button>
              {sortedTasks.length > 0 && (
                <button
                  className="btn btn-save-template"
                  onClick={saveTemplate}
                  title="Save current tasks as template"
                >
                  💾 Save Template
                </button>
              )}
            </>
          )}
          {sessionState === 'finished' && (
            <>
              <button className="btn btn-reset" onClick={handleReset}>
                ↺ New Run
              </button>
              {sortedTasks.length > 0 && (
                <button
                  className="btn btn-save-template"
                  onClick={saveTemplate}
                  title="Save current tasks as template"
                >
                  💾 Save Template
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {(sessionState === 'idle' || sessionState === 'paused') && (
        <div className="add-section">
          <form className="add-form" onSubmit={handleSubmit}>
            <div className="picker-row">
              <div className="emoji-picker">
                {TASK_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className={`emoji-opt ${newEmoji === em ? 'active' : ''}`}
                    onClick={() => setNewEmoji(em)}
                  >
                    {em}
                  </button>
                ))}
                <button
                  type="button"
                  className="emoji-opt emoji-more"
                  onClick={() => setShowEmojiPopup(!showEmojiPopup)}
                  title="More emojis"
                >
                  ＋
                </button>
                {showEmojiPopup && (
                  <div className="emoji-popup">
                    <input
                      type="text"
                      className="emoji-search-input"
                      placeholder="Search emojis..."
                      value={emojiSearch}
                      onChange={(e) => setEmojiSearch(e.target.value)}
                      autoFocus
                    />
                    <div className="emoji-popup-grid">
                      {filteredEmojis.map((em) => (
                        <button
                          key={em}
                          type="button"
                          className={`emoji-popup-item ${newEmoji === em ? 'active' : ''}`}
                          onClick={() => { setNewEmoji(em); setShowEmojiPopup(false); }}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="color-picker">
                {TASK_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-opt ${newColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
                <input
                  type="color"
                  className="color-input"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  title="Pick any color"
                />
              </div>
              <button
                type="button"
                className="type-toggle"
                onClick={() => addTask('Rest', 600, '😴', DEFAULT_COLOR, 'rest')}
                title="Add a 10-minute rest / break task"
              >
                ☕ Rest
              </button>
            </div>
            <div className="add-row">
              <span className="selected-emoji">{newEmoji}</span>
              <input
                type="text"
                placeholder="Task name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input-name"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="min"
                value={newMinutes}
                onChange={(e) => setNewMinutes(e.target.value)}
                className="input-minutes"
              />
              <span className="input-label">min</span>
              <button type="submit" className="btn btn-add">
                + Add
              </button>
            </div>
          </form>

          <div className="templates-section">
            <div className="templates-header">
              <span className="templates-title">Templates</span>
              <div className="templates-global-actions">
                <button
                  className="btn btn-export-tpl"
                  onClick={exportTemplates}
                  title="Export all templates to JSON file"
                >
                  📤 Export
                </button>
                <label className="btn btn-import-tpl">
                  📥 Import
                  <input
                    type="file"
                    accept=".json"
                    onChange={importTemplates}
                    style={{ display: 'none' }}
                  />
                </label>
                {showPresets && sortedTasks.length === 0 && (
                  <button className="btn btn-presets" onClick={loadPresets}>
                    🎮 Load Example Splits
                  </button>
                )}
              </div>
            </div>
            <div className="templates-grid">
              {savedTemplates.map((tpl) => (
                <div key={tpl.id} className="template-card">
                  <div className="template-info">
                    <span className="template-name">{tpl.name}</span>
                    <span className="template-count">{tpl.tasks.length} tasks</span>
                  </div>
                  <div className="template-actions">
                    <button className="btn btn-load-tpl" onClick={() => loadTemplate(tpl)}>
                      Load
                    </button>
                    <button className="btn btn-del-tpl" onClick={() => deleteTemplate(tpl.id)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {savedTemplates.length === 0 && !showPresets && (
                <p className="templates-empty">No saved templates yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        <div className="timer-block timer-next">
          <span className="timer-label">⏳ Осталось работать</span>
          <span className="timer-value">
            {formatTime(remainingWorkSec * 1000, true)}
          </span>
        </div>
        <div className="timer-block timer-clock">
          <span className="timer-label">🕐 Текущее время</span>
          <span className="timer-value timer-clock-value">
            {(() => {
              const utc8 = new Date(currentTime.getTime() + 8 * 60 * 60 * 1000);
              const hh = String(utc8.getUTCHours()).padStart(2, '0');
              const mm = String(utc8.getUTCMinutes()).padStart(2, '0');
              const ss = String(utc8.getUTCSeconds()).padStart(2, '0');
              return `${hh}:${mm}:${ss}`;
            })()}
          </span>
        </div>
        <div className="timer-block timer-session">
          <span className="timer-label">⏱ Сколько длится сессия</span>
          <span className="timer-value timer-main">{formatTime(elapsed, true)}</span>
          <div className="timer-jump">
            <input
              className="jump-input"
              type="text"
              inputMode="decimal"
              placeholder="+5 or -2"
              value={jumpStr}
              onChange={(e) => setJumpStr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleJump(); }}
              disabled={sessionState === 'idle' || sessionState === 'finished'}
            />
            <button
              className="btn btn-jump"
              onClick={handleJump}
              disabled={sessionState === 'idle' || sessionState === 'finished'}
              title="Jump to time"
            >
              ⏩
            </button>
          </div>
          <span className="timer-planned">
            Planned: {formatTime(totalPlannedSec * 1000, false)}
          </span>
        </div>
      </footer>

      <div className="timeline-container" ref={timelineRef} onDragOver={handleTimelineDragOver} onDrop={handleTimelineDrop}>
        {sortedTasks.length === 0 && sessionState === 'idle' ? (
          <div className="empty-state">
            <p>Add tasks to create your speedrun splits</p>
            <p className="hint">Each task = one split with a planned time. Height = sqrt-scaled for visual balance.</p>
          </div>
        ) : (
          <div className="timeline-inner">
            {/* Thermometer column (planned) — glass tube with elapsed-time ticks */}
            <div
              className="timeline-thermo"
              style={{ height: timelineHeight, '--thermo-color': currentTask?.color } as React.CSSProperties}
            >
              <div className="thermo-fill" ref={fillRef} />
              <div className="thermo-marks">
                <div className="thermo-mark" style={{ top: 12 }}>
                  <span className="thermo-mark-label">0:00</span>
                </div>
                {rulerMarks.map((m) => (
                  <div key={m.sec} className="thermo-mark" style={{ top: m.px }}>
                    <span className="thermo-mark-label">{m.label}</span>
                  </div>
                ))}
              </div>
              {sortedTasks.map((task, idx) => {
                const dotSec = cumulativeTimes[idx];
                const dotPx = taskLayout[idx].offset;
                const filled = sessionState !== 'idle' && sessionElapsedSec >= dotSec;
                return (
                  <div
                    key={idx}
                    className={`thermo-dot ${filled ? 'filled' : ''}`}
                    style={{ top: dotPx, '--dot-color': task.color } as React.CSSProperties}
                    title={task.name}
                  >
                    <span className="thermo-dot-emoji">{task.emoji}</span>
                  </div>
                );
              })}
              {showPlayhead && (
                <div className="thermo-marker" ref={playheadRef} />
              )}
            </div>

            {/* Task blocks */}
            <div className="timeline-tracks" style={{ height: timelineHeight }}>
              {/* thermo-fill moved to thermo column */}

              {sortedTasks.map((task, idx) => {
                const layout = taskLayout[idx];
                const isCompleted = task.completedAt !== null;
                const isCurrent = idx === currentTaskIdx && sessionState !== 'idle';
                const plannedStartSec = cumulativeTimes[idx];
                const plannedEndSec = plannedStartSec + task.plannedTime;

                let delta: number | null = null;
                let remaining: number | null = null;
                if (isCompleted && task.completedAt !== null) {
                  delta = (task.completedAt - plannedEndSec) * 1000;
                } else if (sessionState === 'running' || sessionState === 'paused') {
                  if (isCurrent) {
                    // Start from the latest completed task's actual completion time
                    let taskStart = 0;
                    for (const st of sortedTasks) {
                      if (st.completedAt !== null && st.completedAt > taskStart) {
                        taskStart = st.completedAt;
                      }
                    }
                    const elapsedInTask = Math.max(0, sessionElapsedSec - taskStart);
                    remaining = (task.plannedTime - elapsedInTask) * 1000;
                  }
                  if (isCurrent && sessionState === 'running') {
                    const actualProgressSec = sessionElapsedSec - plannedStartSec;
                    const remainingPlanned = task.plannedTime - actualProgressSec;
                    delta = -(remainingPlanned + timeCredit) * 1000;
                  }
                }

                let segmentTime: string | null = null;
                if (isCompleted && task.completedAt !== null) {
                  let prevCompletedAt = 0;
                  for (let i = idx - 1; i >= 0; i--) {
                    if (sortedTasks[i].completedAt !== null) {
                      prevCompletedAt = sortedTasks[i].completedAt!;
                      break;
                    }
                  }
                  segmentTime = formatTime((task.completedAt - prevCompletedAt) * 1000, true);
                }

                let displayRealTime = formatRealTime(plannedEndSec);
                if (!isCompleted) {
                  const currentIdx = sortedTasks.findIndex(t => t.completedAt === null);
                  if (currentIdx !== -1 && idx >= currentIdx) {
                    let lastCompletedAt = 0;
                    for (const st of sortedTasks) {
                      if (st.completedAt !== null && st.completedAt > lastCompletedAt) {
                        lastCompletedAt = st.completedAt;
                      }
                    }
                    const elapsedInCurrent = Math.max(0, sessionElapsedSec - lastCompletedAt);
                    const remainingOfCurrent = sortedTasks[currentIdx].plannedTime - elapsedInCurrent;
                    
                    let totalRemainingSec = remainingOfCurrent;
                    for (let i = currentIdx + 1; i <= idx; i++) {
                      totalRemainingSec += sortedTasks[i].plannedTime;
                    }
                    
                    displayRealTime = formatWallTime(now + (totalRemainingSec - timeCredit) * 1000);
                  }
                }

                return (
                  <div
                    key={task.id}
                    className={`task-block ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${task.type === 'rest' ? 'rest' : ''} ${dragIdx === idx ? 'dragging' : ''} ${dragOverIdx === idx && dragIdx !== idx ? 'drag-over' : ''}`}
                    style={{ top: layout.offset, height: layout.height, '--task-color': task.color } as React.CSSProperties}
                    draggable={sessionState === 'idle' || sessionState === 'paused'}
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)}
                    onDragEnd={onDragEnd}
                  >
                    <div className="block-left">
                      {sessionState === 'idle' && (
                        <span className="drag-handle" title="Drag to reorder">⠿</span>
                      )}
                      <span
                        className="task-emoji"
                        onClick={() => {
                          if (sessionState === 'idle' || sessionState === 'paused') {
                            setEditingEmojiId(task.id);
                            setEmojiEditSearch('');
                          }
                        }}
                        title="Click to change emoji"
                        style={{ cursor: sessionState === 'idle' || sessionState === 'paused' ? 'pointer' : 'default' }}
                      >
                        {task.emoji}
                      </span>
                      <span
                        className="task-color-swatch"
                        onClick={() => {
                          if (sessionState === 'idle' || sessionState === 'paused') {
                            setEditingColorId(task.id);
                          }
                        }}
                        title="Click to change color"
                        style={{
                          background: task.color,
                          cursor: sessionState === 'idle' || sessionState === 'paused' ? 'pointer' : 'default',
                        }}
                      />
                      {task.type === 'rest' && (
                        <span className="task-type-badge" title="Rest / break">☕ Rest</span>
                      )}
                      <div className="block-info">
                        {editingNameId === task.id ? (
                          <input
                            className="edit-name-input"
                            type="text"
                            value={editNameStr}
                            onChange={(e) => setEditNameStr(e.target.value)}
                            onBlur={() => commitEditName(task.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitEditName(task.id); if (e.key === 'Escape') setEditingNameId(null); }}
                            autoFocus
                          />
                        ) : (
                          <span
                            className="task-name"
                            onClick={() => {
                              if (sessionState === 'idle' || sessionState === 'paused') {
                                startEditName(task.id, task.name);
                              }
                            }}
                            title="Click to rename"
                            style={{ cursor: sessionState === 'idle' || sessionState === 'paused' ? 'pointer' : 'default' }}
                          >
                            {task.name}
                          </span>
                        )}
                        <div className="block-timers">
                          {remaining !== null && (
                            <div className="timer-stack">
                              <span className="timer-caption">Времени на задачу осталось</span>
                              <span className={`task-remaining ${remaining < 0 ? 'overdue' : ''}`}>
                                {formatTime(Math.abs(remaining), true)}
                              </span>
                            </div>
                          )}
                          {editingTimeId === task.id ? (
                            <input
                              className="edit-time-input"
                              placeholder="m:ss or h:mm:ss"
                              type="text"
                              inputMode="decimal"
                              value={editTimeStr}
                              onChange={(e) => setEditTimeStr(e.target.value)}
                              onBlur={() => commitEditTime(task.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEditTime(task.id); if (e.key === 'Escape') setEditingTimeId(null); }}
                              autoFocus
                            />
                          ) : (
                            <span
                              className="task-planned-lg task-planned-clickable"
                              onClick={() => { if (sessionState === 'idle' || sessionState === 'paused') startEditTime(task.id, task.plannedTime); }}
                              title="Click to edit time"
                            >
                              {formatTime(task.plannedTime * 1000, false)}
                            </span>
                          )}
                        </div>
                        <span
                          className={`task-delta ${delta !== null && delta < 0 ? 'ahead' : ''} ${delta !== null && delta > 0 ? 'behind' : ''}`}
                        >
                          {delta !== null ? formatDelta(delta) : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="block-right">
                      <span className="task-segment">{segmentTime ?? '—'}</span>
                      <span className="task-realtime">
                        {displayRealTime}
                      </span>
                      <div className="task-actions">
                        {!isCompleted && sessionState === 'running' && (
                          <button
                            className="btn btn-complete"
                            onClick={() => completeTask(task.id)}
                            title="Complete split"
                          >
                            ✓
                          </button>
                        )}
                        {isCompleted && (sessionState === 'running' || sessionState === 'paused') && (
                          <button
                            className="btn btn-undo"
                            onClick={() => uncompleteTask(task.id)}
                            title="Undo"
                          >
                            ↩
                          </button>
                        )}
                        {(sessionState === 'idle' || sessionState === 'paused') && (
                          <>
                            <button
                              className="btn btn-copy"
                              onClick={() => copyTask(task.id)}
                              title="Copy task"
                            >
                              📋
                            </button>
                            <button
                              className="btn btn-remove"
                              onClick={() => removeTask(task.id)}
                              title="Remove"
                            >
                              ✕
                            </button>
                          </>
                        )}
                        {sessionState === 'paused' && isCurrent && (
                          <button
                            className="btn btn-split"
                            onClick={splitTask}
                            title="Split task at current time"
                          >
                            ✂
                          </button>
                        )}
                      </div>
                    </div>
                  {(sessionState === 'idle' || sessionState === 'paused') && (
                    <div
                      className="resize-handle"
                      onMouseDown={(e) => handleResizeStart(e, task.id, layout.height)}
                    />
                  )}
                  </div>
                );
              })}

              {sortedTasks.length > 0 && (
                <div className="finish-line" style={{ top: timelineHeight }}>
                  <span className="finish-label">🏁 Finish</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showSidebar && (
        <div className="sidebar">
          <div className="sidebar-header">
            <span>📋 Task Templates</span>
            <button className="btn btn-sidebar-close" onClick={() => setShowSidebar(false)}>✕</button>
          </div>
          <div className="sidebar-form">
            <span className="sidebar-emoji">{tplEmoji}</span>
            <input className="sidebar-input" placeholder="Name" value={tplName} onChange={e => setTplName(e.target.value)} />
            <input className="sidebar-input sidebar-input-sm" placeholder="min" value={tplMinutes} onChange={e => setTplMinutes(e.target.value)} />
            <button
              type="button"
              className={`type-toggle type-toggle-sm ${tplType === 'rest' ? 'active' : ''}`}
              onClick={() => setTplType(tplType === 'rest' ? 'task' : 'rest')}
              title={tplType === 'rest' ? 'Regular task' : 'Rest / break — no congratulations on completion'}
            >
              ☕
            </button>
            <button className="btn btn-add btn-add-sm" onClick={addTaskTemplate}>+</button>
          </div>
          <div className="sidebar-emoji-row">
            {TASK_EMOJIS.map(em => (
              <button key={em} type="button" className={`emoji-opt ${tplEmoji===em?'active':''}`} onClick={()=>setTplEmoji(em)}>{em}</button>
            ))}
            <button type="button" className="emoji-opt emoji-more" onClick={()=>setShowTplEmojiPopup(!showTplEmojiPopup)} title="More">＋</button>
            {showTplEmojiPopup && (
              <div className="emoji-popup tpl-popup">
                <input
                  type="text"
                  className="emoji-search-input"
                  placeholder="Search emojis..."
                  value={tplEmojiSearch}
                  onChange={(e) => setTplEmojiSearch(e.target.value)}
                  autoFocus
                />
                <div className="emoji-popup-grid">
                  {filteredTplEmojis.map(em => (
                    <button key={em} type="button" className={`emoji-popup-item ${tplEmoji===em?'active':''}`} onClick={()=>{setTplEmoji(em);setShowTplEmojiPopup(false)}}>{em}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="sidebar-color-row">
            {TASK_COLORS.map(c => (
              <button key={c} className={`color-opt ${tplColor===c?'active':''}`} style={{background:c}} onClick={()=>setTplColor(c)} />
            ))}
            <input type="color" className="color-input" value={tplColor} onChange={e=>setTplColor(e.target.value)} title="Pick any color" />
          </div>
          <div className="sidebar-list">
            {taskTemplates.map(tpl => (
              <div
                key={tpl.id}
                className="sidebar-card"
                draggable
                onDragStart={e => { e.dataTransfer.setData('text/plain', tpl.id); e.dataTransfer.effectAllowed = 'copy'; }}
              >
                <span className="sidebar-card-emoji">{tpl.emoji}</span>
                <span className="sidebar-card-name">{tpl.name}</span>
                {tpl.type === 'rest' && <span className="sidebar-type-badge" title="Rest / break">☕</span>}
                <span className="sidebar-card-time">{formatTime(tpl.plannedTime*1000, false)}</span>
                <button className="btn btn-sidebar-del" onClick={()=>deleteTaskTemplate(tpl.id)}>✕</button>
              </div>
            ))}
            {taskTemplates.length === 0 && <p className="sidebar-empty">No templates yet. Create one above.</p>}
          </div>
          <p className="sidebar-hint">Drag cards onto timeline to add tasks</p>
        </div>
      )}

      {/* Global emoji picker overlay */}
      {editingEmojiTask && (
        <div className="emoji-overlay" onClick={() => { setEditingEmojiId(null); setEmojiEditSearch(''); }}>
          <div className="emoji-overlay-popup" onClick={e => e.stopPropagation()}>
            <div className="emoji-overlay-header">
              <span>Choose emoji for <strong>{editingEmojiTask.name}</strong></span>
              <button
                className="emoji-overlay-close"
                onClick={() => { setEditingEmojiId(null); setEmojiEditSearch(''); }}
                title="Cancel"
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              className="emoji-search-input"
              placeholder="Search emojis..."
              value={emojiEditSearch}
              onChange={(e) => setEmojiEditSearch(e.target.value)}
              autoFocus
            />
            <div className="emoji-popup-grid">
              {filteredEditEmojis.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={`emoji-popup-item ${editingEmojiTask.emoji === em ? 'active' : ''}`}
                  onClick={() => changeTaskEmoji(editingEmojiTask.id, em)}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Global color picker overlay */}
      {editingColorTask && (
        <div className="emoji-overlay" onClick={() => setEditingColorId(null)}>
          <div className="emoji-overlay-popup" onClick={e => e.stopPropagation()}>
            <div className="emoji-overlay-header">
              <span>Choose color for <strong>{editingColorTask.name}</strong></span>
              <button
                className="emoji-overlay-close"
                onClick={() => setEditingColorId(null)}
                title="Cancel"
              >
                ✕
              </button>
            </div>
            <div className="color-picker color-picker-overlay">
              {TASK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-opt ${editingColorTask.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => changeTaskColor(editingColorTask.id, c)}
                />
              ))}
              <input
                type="color"
                className="color-input"
                value={editingColorTask.color}
                onChange={(e) => {
                  setTasks(prev => prev.map(t => t.id === editingColorTask.id ? { ...t, color: e.target.value } : t));
                }}
                title="Pick any color"
              />
            </div>
          </div>
        </div>
      )}

      {/* Congratulations on completing a regular task */}
      {congrats && (
        <div className="congrats-overlay" key={congrats.id} aria-hidden="true">
          <div className="congrats-text">
            <span className="congrats-emoji">🎉</span>
            <div>
              <div className="congrats-title">Great job!</div>
              <div className="congrats-sub">"{congrats.name}" completed</div>
            </div>
          </div>
        </div>
      )}

      {/* Save template dialog */}
      {showSaveTpl && (
        <div className="emoji-overlay" onClick={() => setShowSaveTpl(false)}>
          <div className="emoji-overlay-popup" onClick={e => e.stopPropagation()}>
            <div className="emoji-overlay-header">
              <span>Save template</span>
              <button
                className="emoji-overlay-close"
                onClick={() => setShowSaveTpl(false)}
                title="Cancel"
              >
                ✕
              </button>
            </div>
            <input
              className="emoji-search-input"
              type="text"
              placeholder="Template name..."
              value={saveTplName}
              onChange={(e) => setSaveTplName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmSaveTemplate(); if (e.key === 'Escape') setShowSaveTpl(false); }}
              autoFocus
            />
            <div className="tpl-save-actions">
              <button className="btn btn-cancel" onClick={() => setShowSaveTpl(false)}>
                Cancel
              </button>
              <button className="btn btn-add" onClick={confirmSaveTemplate} disabled={!saveTplName.trim()}>
                💾 Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edge glow flash when switching to the next task — decorative overlay, never intercepts clicks */}
      {glow && (
        <div key={glow.id} className="task-glow" style={{ '--glow-color': glow.color } as React.CSSProperties} aria-hidden="true" />
      )}
    </div>
  );
}

export default App;
