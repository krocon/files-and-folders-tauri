import {
  badgeFor,
  canonicalShortcut,
  eventKey,
  formatShortcut,
  KeyEventLike,
  NO_MODIFIERS,
  parseShortcut,
  strokeFromEvent,
  strokeToString,
} from './shortcut';

const ev = (key: string, code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('shortcut notation', () => {
  it('canonicalises modifier order, case and aliases', () => {
    expect(canonicalShortcut('shift+mod+s', 'linux')).toBe('Mod+Shift+S');
    expect(canonicalShortcut('alt+cmd+left', 'macos')).toBe('Mod+Alt+ArrowLeft');
    expect(canonicalShortcut('ctrl+delete', 'windows')).toBe('Mod+Delete');
    expect(canonicalShortcut('ctrl+del', 'windows')).toBe('Mod+Delete');
    expect(canonicalShortcut('num_add', 'linux')).toBe('NumpadAdd');
    expect(canonicalShortcut('f12', 'linux')).toBe('F12');
    expect(canonicalShortcut('Mod++', 'linux')).toBe('Mod++');
  });

  it('keeps Ctrl separate from ⌘ on macOS only', () => {
    expect(canonicalShortcut('Ctrl+Tab', 'macos')).toBe('Ctrl+Tab');
    expect(canonicalShortcut('Ctrl+Tab', 'windows')).toBe('Mod+Tab');
  });

  it('parses chords and rejects invalid input', () => {
    expect(parseShortcut('Ctrl+K F6', 'macos')?.map(strokeToString)).toEqual(['Ctrl+K', 'F6']);
    for (const bad of ['', 'Hyper+A', 'Mod+', 'F99', 'A B C', 'Mod+Banana']) {
      expect(canonicalShortcut(bad, 'linux'), bad).toBeNull();
    }
  });

  it('reads letters from key, but from code when ⌥ changes the character (macOS)', () => {
    expect(eventKey(ev('s', 'KeyS'))).toBe('S');
    expect(eventKey(ev('ø', 'KeyO', { altKey: true }))).toBe('O');
    // QWERTZ: the key labelled Z sits where QWERTY has Y – key wins
    expect(eventKey(ev('z', 'KeyY'))).toBe('Z');
  });

  it('reads digits and the numpad from code (layout-independent)', () => {
    expect(eventKey(ev('/', 'Digit7', { shiftKey: true }))).toBe('7'); // German Shift+7
    expect(eventKey(ev('¡', 'Digit1', { altKey: true }))).toBe('1');
    expect(eventKey(ev('+', 'NumpadAdd'))).toBe('NumpadAdd');
    expect(eventKey(ev('Enter', 'NumpadEnter'))).toBe('Enter');
  });

  it('names special keys and ignores lone modifiers', () => {
    expect(eventKey(ev(' ', 'Space'))).toBe('Space');
    expect(eventKey(ev('F5', 'F5'))).toBe('F5');
    expect(eventKey(ev('>', 'Period', { shiftKey: true }))).toBe('.');
    expect(eventKey(ev('Shift', 'ShiftLeft'))).toBeNull();
    expect(eventKey(ev('Meta', 'MetaLeft'))).toBeNull();
  });

  it('builds the same string from an event as from the keymap', () => {
    const mac = strokeFromEvent(ev('p', 'KeyP', { metaKey: true, shiftKey: true }), 'macos')!;
    expect(strokeToString(mac)).toBe(canonicalShortcut('Mod+Shift+P', 'macos'));
    const win = strokeFromEvent(ev('Tab', 'Tab', { ctrlKey: true }), 'windows')!;
    expect(strokeToString(win)).toBe(canonicalShortcut('Ctrl+Tab', 'windows'));
    const macCtrl = strokeFromEvent(ev('Tab', 'Tab', { ctrlKey: true }), 'macos')!;
    expect(strokeToString(macCtrl)).toBe('Ctrl+Tab');
  });

  it('formats for display per platform', () => {
    expect(formatShortcut('Mod+Shift+P', 'macos')).toBe('⇧⌘P');
    expect(formatShortcut('Mod+Ctrl+Alt+G', 'macos')).toBe('⌃⌥⌘G');
    expect(formatShortcut('Mod+Shift+P', 'windows')).toBe('Ctrl+Shift+P');
    expect(formatShortcut('NumpadAdd', 'linux')).toBe('Num+');
    expect(formatShortcut('Ctrl+K F6', 'macos')).toBe('⌃K F6');
  });

  it('shows the badge without the held modifiers', () => {
    expect(badgeFor(['Shift+F6'], { ...NO_MODIFIERS, shift: true }, 'linux')).toBe('F6');
    expect(badgeFor(['F5'], NO_MODIFIERS, 'linux')).toBe('F5');
    expect(badgeFor(['Mod+F6', 'Mod+Alt+M'], { ...NO_MODIFIERS, mod: true }, 'macos')).toBe('F6');
    expect(badgeFor(['F8'], { ...NO_MODIFIERS, shift: true }, 'linux')).toBe('');
  });
});
