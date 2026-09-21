import { describe, expect, it } from 'vitest';
import CalendarPage from './CalendarPage';
import SessionPopover from './SessionPopover';
import TaskDialog from './TaskDialog';

describe('calendar feature modules', () => {
  it('loads the calendar and both editors after the preset additions', () => {
    expect(typeof CalendarPage).toBe('function');
    expect(typeof SessionPopover).toBe('function');
    expect(typeof TaskDialog).toBe('function');
  });
});
