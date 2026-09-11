export type TaskType = 'task' | 'rest'; // 'task' = regular, 'rest' = service break (no congrats)

export interface Task {
  id: string;
  name: string;
  plannedTime: number; // seconds
  completedAt: number | null; // session elapsed seconds when completed, null = not done
  order: number;
  emoji: string; // single emoji icon
  color: string; // hex color
  type: TaskType;
}

export interface Template {
  id: string;
  name: string;
  tasks: { name: string; plannedTime: number; emoji: string; color: string; type: TaskType }[];
}

// Full, resumable state of a single day: the planned/completed tasks plus where
// the timeline was left, so a past day can be reopened and continued.
export interface DayState {
  date: string; // 'YYYY-MM-DD' (local)
  tasks: Task[];
  elapsedMs: number; // timeline progress, in ms
  timeCredit: number; // banked seconds from early completions
  sessionState: SessionState;
  startedAt: number | null; // wall-clock anchor for ruler labels
}

export type SessionState = 'idle' | 'running' | 'paused' | 'finished';

export const DEFAULT_EMOJI = '⬜';
export const DEFAULT_COLOR = '#3498db';
export const TASK_COLORS = ['#3498db', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#00d4ff'];
export const TASK_EMOJIS = ['📋', '🛠️', '🧪', '👀', '🚀', '📦', '🐛', '💡', '🎯', '⚡'];

// Choosing the default square avatar means "surprise me": substitute a random task avatar.
export function resolveTaskEmoji(emoji: string): string {
  if (!emoji || emoji === DEFAULT_EMOJI) {
    return TASK_EMOJIS[Math.floor(Math.random() * TASK_EMOJIS.length)];
  }
  return emoji;
}

export interface TaskTemplate {
  id: string;
  name: string;
  plannedTime: number;
  emoji: string;
  color: string;
  type: TaskType;
}

export interface DayStats {
  date: string; // 'YYYY-MM-DD' (local)
  workSec: number; // total time spent on regular tasks
  restSec: number; // time spent on 'rest'-type tasks
  sessions: number; // how many sessions were logged that day
}

// A single completed run (session), tied to the day it started.
export interface RunRecord {
  id: number;
  date: string; // 'YYYY-MM-DD' (local) — the day the run started
  startedAt: number; // epoch ms when the run started
  endedAt: number; // epoch ms when the run ended
  workSec: number; // seconds spent on regular tasks
  restSec: number; // seconds spent on 'rest'-type tasks
  plannedSec: number; // total planned seconds of the session's tasks
  tasks: Task[]; // snapshot of the session's plan (survives tracker reset)
}

export interface SleepEntry {
  bed: number | null; // minutes from midnight when the person went to bed
  wake: number | null; // minutes from midnight when the person woke up
}

export interface EmojiEntry {
  emoji: string;
  keywords: string[];
}

export const EMOJI_DATA: EmojiEntry[] = [
  { emoji: '😀', keywords: ['smile', 'happy', 'grin', 'cheerful'] },
  { emoji: '😂', keywords: ['laugh', 'lol', 'tears', 'joy', 'funny'] },
  { emoji: '🤣', keywords: ['rolling', 'floor', 'hilarious', 'dying'] },
  { emoji: '😍', keywords: ['love', 'heart', 'eyes', 'adore', 'crush'] },
  { emoji: '🥰', keywords: ['affection', 'love', 'blush', 'cute'] },
  { emoji: '😎', keywords: ['cool', 'sunglasses', 'awesome', 'rad'] },
  { emoji: '🤩', keywords: ['star', 'excited', 'amazed', 'wow'] },
  { emoji: '😡', keywords: ['angry', 'mad', 'furious', 'rage'] },
  { emoji: '😭', keywords: ['cry', 'sad', 'tears', 'sob', 'upset'] },
  { emoji: '😱', keywords: ['scream', 'shocked', 'terrified', 'fear'] },
  { emoji: '🥳', keywords: ['party', 'celebrate', 'birthday', 'congrats'] },
  { emoji: '😴', keywords: ['sleep', 'tired', 'bed', 'zzz', 'nap'] },
  { emoji: '🤔', keywords: ['think', 'thinking', 'hmm', 'ponder', 'consider'] },
  { emoji: '🙄', keywords: ['eye', 'roll', 'annoyed', 'whatever'] },
  { emoji: '😬', keywords: ['wince', 'nervous', 'awkward', 'cringe'] },
  { emoji: '🤗', keywords: ['hug', 'hugs', 'embrace', 'warm'] },
  { emoji: '🤝', keywords: ['handshake', 'agree', 'deal', 'partners'] },
  { emoji: '👋', keywords: ['wave', 'bye', 'hello', 'greeting', 'hi'] },
  { emoji: '👍', keywords: ['thumbs', 'up', 'good', 'like', 'approve', 'ok'] },
  { emoji: '👎', keywords: ['thumbs', 'down', 'bad', 'dislike', 'disapprove'] },
  { emoji: '💪', keywords: ['flex', 'strong', 'power', 'biceps', 'muscle'] },
  { emoji: '🙏', keywords: ['pray', 'please', 'thanks', 'thank', 'hope'] },
  { emoji: '💀', keywords: ['skull', 'dead', 'death', 'bones', 'danger'] },
  { emoji: '👽', keywords: ['alien', 'ufo', 'space', 'extraterrestrial'] },
  { emoji: '🤖', keywords: ['robot', 'ai', 'machine', 'android', 'bot'] },
  { emoji: '🎃', keywords: ['pumpkin', 'halloween', 'spooky', 'jack'] },
  { emoji: '🐶', keywords: ['dog', 'puppy', 'pet', 'animal', 'woof'] },
  { emoji: '🐱', keywords: ['cat', 'kitten', 'pet', 'animal', 'meow'] },
  { emoji: '🦊', keywords: ['fox', 'animal', 'clever', 'cute'] },
  { emoji: '🐼', keywords: ['panda', 'animal', 'cute', 'bear'] },
  { emoji: '🐨', keywords: ['koala', 'animal', 'sleepy', 'cute'] },
  { emoji: '🐸', keywords: ['frog', 'toad', 'animal', 'ribbit'] },
  { emoji: '🐵', keywords: ['monkey', 'ape', 'animal', 'banana'] },
  { emoji: '🦁', keywords: ['lion', 'king', 'jungle', 'animal', 'roar'] },
  { emoji: '🐮', keywords: ['cow', 'moo', 'animal', 'farm'] },
  { emoji: '🐷', keywords: ['pig', 'oink', 'animal', 'farm'] },
  { emoji: '🐔', keywords: ['chicken', 'cluck', 'animal', 'farm'] },
  { emoji: '🐙', keywords: ['octopus', 'squid', 'sea', 'ocean'] },
  { emoji: '🦋', keywords: ['butterfly', 'insect', 'wings', 'beauty'] },
  { emoji: '🐝', keywords: ['bee', 'honey', 'insect', 'buzz'] },
  { emoji: '🐢', keywords: ['turtle', 'tortoise', 'slow', 'shell'] },
  { emoji: '🦖', keywords: ['dinosaur', 'trex', 't-rex', 'extinct'] },
  { emoji: '🦕', keywords: ['brontosaurus', 'dinosaur', 'long', 'neck'] },
  { emoji: '🐳', keywords: ['whale', 'spout', 'ocean', 'sea'] },
  { emoji: '🦈', keywords: ['shark', 'fish', 'teeth', 'ocean', 'jaws'] },
  { emoji: '🐊', keywords: ['crocodile', 'alligator', 'reptile'] },
  { emoji: '🦜', keywords: ['parrot', 'bird', 'tropical', 'talk'] },
  { emoji: '🐉', keywords: ['dragon', 'mythical', 'fire', 'fantasy'] },
  { emoji: '🍎', keywords: ['apple', 'fruit', 'red', 'pie'] },
  { emoji: '🍕', keywords: ['pizza', 'cheese', 'italian', 'slice', 'food'] },
  { emoji: '🍔', keywords: ['burger', 'hamburger', 'fastfood', 'food'] },
  { emoji: '🌮', keywords: ['taco', 'mexican', 'food', 'burrito'] },
  { emoji: '🍣', keywords: ['sushi', 'japanese', 'rice', 'fish'] },
  { emoji: '🍩', keywords: ['donut', 'sweet', 'dessert', 'glazed'] },
  { emoji: '🎂', keywords: ['cake', 'birthday', 'candles', 'celebrate'] },
  { emoji: '☕', keywords: ['coffee', 'tea', 'hot', 'drink', 'caffeine'] },
  { emoji: '🍺', keywords: ['beer', 'drink', 'brew', 'pub', 'ale'] },
  { emoji: '🍷', keywords: ['wine', 'glass', 'drink', 'vine'] },
  { emoji: '🥤', keywords: ['cup', 'shake', 'straw', 'drink', 'soda'] },
  { emoji: '🧃', keywords: ['juice', 'box', 'drink', 'fruit'] },
  { emoji: '🍿', keywords: ['popcorn', 'movie', 'snack', 'theater'] },
  { emoji: '🥑', keywords: ['avocado', 'guacamole', 'healthy', 'toast'] },
  { emoji: '🧀', keywords: ['cheese', 'wedge', 'swiss', 'cheddar'] },
  { emoji: '🍌', keywords: ['banana', 'fruit', 'yellow', 'monkey'] },
  { emoji: '🍇', keywords: ['grapes', 'fruit', 'vine', 'wine'] },
  { emoji: '🥩', keywords: ['meat', 'steak', 'chop', 'beef'] },
  { emoji: '🍪', keywords: ['cookie', 'chocolate', 'sweet', 'snack'] },
  { emoji: '🧁', keywords: ['cupcake', 'muffin', 'frosting', 'dessert'] },
  { emoji: '⚽', keywords: ['soccer', 'football', 'ball', 'sport'] },
  { emoji: '🏀', keywords: ['basketball', 'ball', 'sport', 'hoop'] },
  { emoji: '🎮', keywords: ['game', 'controller', 'gaming', 'play', 'video'] },
  { emoji: '🎸', keywords: ['guitar', 'music', 'instrument', 'rock'] },
  { emoji: '🎨', keywords: ['art', 'paint', 'palette', 'color', 'creative'] },
  { emoji: '🎬', keywords: ['movie', 'film', 'director', 'action', 'clapboard'] },
  { emoji: '📚', keywords: ['books', 'read', 'study', 'library', 'knowledge'] },
  { emoji: '✈️', keywords: ['plane', 'fly', 'travel', 'airport', 'jet'] },
  { emoji: '🚗', keywords: ['car', 'vehicle', 'drive', 'auto', 'transport'] },
  { emoji: '🚲', keywords: ['bicycle', 'bike', 'cycle', 'ride'] },
  { emoji: '🏆', keywords: ['trophy', 'win', 'award', 'champion', 'prize'] },
  { emoji: '🎪', keywords: ['circus', 'tent', 'show', 'entertainment'] },
  { emoji: '🎲', keywords: ['dice', 'gambling', 'random', 'game', 'board'] },
  { emoji: '🧩', keywords: ['puzzle', 'piece', 'problem', 'challenge'] },
  { emoji: '🎭', keywords: ['theater', 'masks', 'drama', 'performing', 'art'] },
  { emoji: '🎤', keywords: ['mic', 'microphone', 'sing', 'karaoke', 'stage'] },
  { emoji: '🔮', keywords: ['crystal', 'ball', 'fortune', 'magic', 'mystical'] },
  { emoji: '🕹️', keywords: ['joystick', 'game', 'arcade', 'retro', 'control'] },
  { emoji: '🃏', keywords: ['joker', 'card', 'playing', 'wildcard'] },
  { emoji: '⭐', keywords: ['star', 'favorite', 'rating', 'shine'] },
  { emoji: '🔥', keywords: ['fire', 'flame', 'hot', 'burn', 'awesome', 'lit'] },
  { emoji: '💯', keywords: ['hundred', 'score', 'perfect', '100', 'points'] },
  { emoji: '❤️', keywords: ['heart', 'red', 'love', 'like'] },
  { emoji: '💚', keywords: ['heart', 'green', 'love', 'health'] },
  { emoji: '💙', keywords: ['heart', 'blue', 'love', 'trust'] },
  { emoji: '✨', keywords: ['sparkles', 'shine', 'glitter', 'magic', 'stars'] },
  { emoji: '🌈', keywords: ['rainbow', 'color', 'sky', 'pride'] },
  { emoji: '☀️', keywords: ['sun', 'sunny', 'day', 'bright', 'hot'] },
  { emoji: '🌙', keywords: ['moon', 'night', 'sleep', 'stars'] },
  { emoji: '⚡', keywords: ['lightning', 'bolt', 'thunder', 'electric', 'fast'] },
  { emoji: '💧', keywords: ['drop', 'water', 'sweat', 'tear', 'liquid'] },
  { emoji: '🎵', keywords: ['note', 'music', 'sound', 'song', 'melody'] },
  { emoji: '🔔', keywords: ['bell', 'notify', 'alarm', 'sound', 'ring'] },
  { emoji: '💰', keywords: ['money', 'bag', 'dollar', 'cash', 'wealth'] },
  { emoji: '📌', keywords: ['pin', 'pushpin', 'map', 'mark', 'location'] },
  { emoji: '✂️', keywords: ['scissors', 'cut', 'divide', 'split'] },
  { emoji: '🔧', keywords: ['wrench', 'tool', 'fix', 'repair', 'mechanic'] },
  { emoji: '💊', keywords: ['pill', 'medicine', 'drug', 'health'] },
  { emoji: '🏁', keywords: ['checkered', 'finish', 'flag', 'racing', 'end'] },
  { emoji: '🚩', keywords: ['flag', 'pin', 'location', 'marker'] },
  { emoji: '🎉', keywords: ['party', 'popper', 'celebration', 'confetti', 'yay'] },
  { emoji: '💣', keywords: ['bomb', 'explosion', 'boom', 'danger'] },
  { emoji: '🧲', keywords: ['magnet', 'attract', 'stick', 'force'] },
  { emoji: '🔑', keywords: ['key', 'lock', 'door', 'access', 'password'] },
  { emoji: '⏰', keywords: ['alarm', 'clock', 'time', 'wake', 'morning'] },
  { emoji: '📷', keywords: ['camera', 'photo', 'picture', 'photography'] },
  { emoji: '💻', keywords: ['laptop', 'computer', 'tech', 'code', 'work'] },
  { emoji: '📱', keywords: ['phone', 'mobile', 'smart', 'cell', 'device'] },
  { emoji: '🖥️', keywords: ['desktop', 'computer', 'pc', 'monitor', 'screen'] },
];

export const ALL_EMOJIS = EMOJI_DATA.map(e => e.emoji);