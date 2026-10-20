import { dropPosition } from './drag-drop-api';

describe('dropPosition (positions of drags from the system)', () => {
  it('macOS and Linux report logical points already – unchanged on a Retina/HiDPI screen', () => {
    // wry: NSView coordinates (macOS), GTK widget coordinates (Linux) – Tauri calls them "physical"
    expect(dropPosition({ x: 900, y: 300 }, 2, 'macos')).toEqual({ x: 900, y: 300 });
    expect(dropPosition({ x: 900, y: 300 }, 2, 'linux')).toEqual({ x: 900, y: 300 });
  });

  it('Windows reports physical pixels (ScreenToClient) – divided by the pixel ratio', () => {
    expect(dropPosition({ x: 900, y: 300 }, 1.5, 'windows')).toEqual({ x: 600, y: 200 });
    expect(dropPosition({ x: 900, y: 300 }, 0, 'windows')).toEqual({ x: 900, y: 300 });
  });
});
