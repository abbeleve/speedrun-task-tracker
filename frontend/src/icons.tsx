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
