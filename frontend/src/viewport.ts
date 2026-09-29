// Screen-size breakpoints shared by the components that lay themselves out in
// JavaScript rather than CSS alone. Keep in step with the 640px media queries
// in App.css and calendar.css.

// Phone-sized screens: no room for a popover beside a block, nor for seven day
// columns side by side.
export const PHONE_QUERY = '(max-width: 640px)';

export function isPhoneScreen(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
}
