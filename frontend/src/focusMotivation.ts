// Short prompts for the sequence hover card. Keeping the selection
// deterministic means a sequence has its own message instead of changing text
// every time the pointer crosses from one of its tasks to the next.
export const FOCUS_MOTIVATIONS = [
  'One clear block. One meaningful win.',
  'Stay with it — momentum is building.',
  'This focused hour belongs to you.',
  'Small steps, fully present.',
  'Protect the focus. Finish the thought.',
  'You only need the next step.',
  'Make this block count.',
  'Quiet mind. Steady hands.',
  'Progress loves uninterrupted time.',
  'Keep going — the hard part is starting.',
  'Give this task your full attention.',
  'One sequence closer to the goal.',
  'Focus now, feel proud later.',
  'You are already in motion.',
  'Turn intention into progress.',
  'Stay patient. Stay precise.',
  'Deep work creates real change.',
  'Let the distractions wait.',
  'Your future self will thank you.',
  'Keep the promise you made to yourself.',
  'A calm pace still moves forward.',
  'Finish this block with purpose.',
  'Attention is your advantage.',
  'Build the result one task at a time.',
  'The next breakthrough needs this focus.',
  'Be here. Do the work.',
  'Consistency beats intensity.',
  'Stay curious and keep moving.',
  'You have enough time for the next step.',
  'Good work grows in focused minutes.',
  'Let progress be the reward.',
  'Trust the plan. Work the plan.',
  'Keep the streak of attention alive.',
  'Make space for your best work.',
  'Breathe in. Lock in.',
  'The goal gets closer with every block.',
  'Choose progress over perfection.',
  'This is where momentum is made.',
  'Stay on the path you chose.',
  'Your focus is stronger than the noise.',
  'Do less, deeply.',
  'Hold the line — you are doing great.',
  'One task now. Everything else later.',
  'Give the work room to become excellent.',
  'Keep showing up for the goal.',
  'A focused finish is within reach.',
  'Turn this time into something real.',
  'You can do hard things calmly.',
  'The work matters. Keep going.',
  'End this sequence stronger than you started.',
] as const;

export function focusMotivation(sequenceId: string): string {
  // FNV-1a: tiny, stable and plenty for distributing ids over 50 messages.
  let hash = 2_166_136_261;
  for (let i = 0; i < sequenceId.length; i += 1) {
    hash ^= sequenceId.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return FOCUS_MOTIVATIONS[(hash >>> 0) % FOCUS_MOTIVATIONS.length];
}
