import type { ReactNode, SVGProps } from 'react';

// The app's own chrome icons: one stroke weight, one grid, drawn in the
// current text colour so they follow the theme and the button's state.
// Emoji stay for what the user picks themselves (task and habit avatars);
// these are for what the app puts on screen.

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconStopwatch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="14" r="8" />
    <path d="M10 2h4M12 2v4M12 14l3-3M19 7l1.5-1.5" />
  </Icon>
);

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
  </Icon>
);

export const IconFlag = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" />
  </Icon>
);

// The calendar's two layouts, for the switch in its toolbar: a column per day
// with blocks stacked down it, or a row per day with blocks laid along it.
export const IconLayoutColumns = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
    <path d="M9 3.5v17M15 3.5v17" />
    <path d="M5.75 7v4M12 9.5v5M17.75 7.5v3.5" strokeWidth={2.5} />
  </Icon>
);

export const IconLayoutRows = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
    <path d="M3 9.25h18M3 14.75h18" />
    <path d="M6.5 6.4h5M10 12h7M7.5 17.6h4" strokeWidth={2.5} />
  </Icon>
);

// The calendar's two designs: a ruled grid of small blocks, or loose
// rounded cards.
export const IconDesignClassic = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="1.5" />
    <path d="M3 9.25h18M3 14.75h18M12 3.5v17" />
  </Icon>
);

export const IconDesignCards = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="8" height="11" rx="3" />
    <rect x="13" y="10" width="8" height="11" rx="3" />
  </Icon>
);

export const IconHome = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9v11.5h13V9" />
    <path d="M10 20.5v-6h4v6" />
  </Icon>
);

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Icon>
);

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Icon>
);

// Pushes about blocks on (bell) or off (bell struck through).
export const IconBell = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5" />
    <path d="M10.25 20.5a2 2 0 0 0 3.5 0" />
  </Icon>
);

export const IconBellOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5" />
    <path d="M10.25 20.5a2 2 0 0 0 3.5 0M3.5 3.5l17 17" />
  </Icon>
);

export const IconLogOut = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 20.5H6a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 6 3.5h3.5" />
    <path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9.5" />
  </Icon>
);

export const IconThermometer = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 14.8V4.5a2 2 0 0 0-4 0v10.3a4 4 0 1 0 4 0Z" />
    <path d="M12 17.5V11" />
  </Icon>
);

// Semicircles of growing radius — the spiral route's one-turn-per-hour idea.
export const IconSpiral = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 12a1 1 0 0 1 2 0 2 2 0 0 1-4 0 3 3 0 0 1 6 0 4 4 0 0 1-8 0 5 5 0 0 1 10 0" />
  </Icon>
);

export const IconList = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6h11.5M9 12h11.5M9 18h11.5" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth={2.5} />
  </Icon>
);

export const IconStory = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 3H8a4 4 0 0 0 0 8h8a4 4 0 0 1 0 8H8" />
    <circle cx="16" cy="3" r="1.5" />
    <circle cx="8" cy="19" r="1.5" />
  </Icon>
);

export const IconPlay = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 4.5v15l12-7.5Z" />
  </Icon>
);

export const IconRewind = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
    <path d="M3.5 3.5v5h5" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

// Chart styles, for the switches beside the habit cards' and the activity
// card's charts. Each is a thumbnail of the chart it picks.

// A half-ring of dots — the habit card's dotted arc.
export const IconChartDots = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 17h.01M6.3 11.3h.01M12 9h.01M17.7 11.3h.01M20 17h.01" strokeWidth={3} />
  </Icon>
);

// A fan of radial capsules — the habit card's gauge.
export const IconChartGauge = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 18h3.5M5.6 11.6l2.5 2.5M12 9v3.5M18.4 11.6l-2.5 2.5M21 18h-3.5" strokeWidth={2.25} />
  </Icon>
);

export const IconChartBars = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 20v-6M10 20V8M15 20v-9M20 20V5" strokeWidth={2.25} />
  </Icon>
);

// Two running totals racing to a finish line.
export const IconChartRace = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 18c5.5 0 6-11 11.5-11H18" />
    <path d="M3 19.5c6 0 6.5-5 11.5-5H18" opacity={0.5} />
    <path d="M20.5 3.5v17" />
  </Icon>
);

// A smooth daily curve over an underlined stretch.
export const IconChartWave = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12c2.5 0 3 3.5 5.5 3.5S12 7 15 7s3.5 4.5 6 4.5" />
    <path d="M12.5 20.5h6" strokeWidth={2.5} />
  </Icon>
);

// The home dashboard's card badges.

// Four squares — the activity heatmap.
export const IconGrid = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.75" />
  </Icon>
);

export const IconBriefcase = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2.5" />
    <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3 12.5h18" />
  </Icon>
);

export const IconCalendarCheck = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4M9 15l2 2 4-4" />
  </Icon>
);

export const IconBed = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 5v15M3 16h18v4M21 16v-3a3 3 0 0 0-3-3h-7.5v6" />
    <circle cx="7" cy="12.5" r="1.75" />
  </Icon>
);

// "Open the full view" — the summary cards' corner button.
export const IconArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17 17 7M8.5 7H17v8.5" />
  </Icon>
);

// The board's actions.
export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14 4.5 9.5 9 5" />
    <path d="M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3" />
  </Icon>
);

// The home page's colour palette.
export const IconPalette = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.7-.8 1.7-1.6 0-1-.7-1.4-.7-2.2 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 7 17 3 12 3Z" />
    <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
    <circle cx="10" cy="7.5" r="1" fill="currentColor" />
    <circle cx="14.5" cy="7.5" r="1" fill="currentColor" />
  </Icon>
);

export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

// The sequence tracker's read-outs: time left by the plan, the clock, and
// the overtake.
export const IconHourglass = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h12M6 21h12" />
    <path d="M7 3v3a5 5 0 0 0 5 5 5 5 0 0 0 5-5V3M7 21v-3a5 5 0 0 1 5-5 5 5 0 0 1 5 5v3" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const IconTrend = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Icon>
);

export const IconShuffle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7h3c4 0 8 10 12 10h3M3 17h3c1.5 0 3-1.4 4.5-3.3M13.5 10.3C15 8.4 16.5 7 18 7h3" />
    <path d="m18 4 3 3-3 3m0 4 3 3-3 3" />
  </Icon>
);

// A streak saver (заморозка).
export const IconSnowflake = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
    <path d="M9.5 4 12 6.5 14.5 4M17.7 5.8l-.9 3.45 3.4.95M20.2 13.8l-3.4.95.9 3.45" />
    <path d="M14.5 20 12 17.5 9.5 20M6.3 18.2l.9-3.45-3.4-.95M3.8 10.2l3.4-.95-.9-3.45" />
  </Icon>
);

// The backlog's search field.
export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);
