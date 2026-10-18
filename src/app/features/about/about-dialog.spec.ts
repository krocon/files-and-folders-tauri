import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AboutApi } from '../../core/about/about-api';
import { AppInfo } from '../../core/about/about.models';
import { ClipboardApi } from '../../core/os/clipboard';
import { DialogService } from '../../shared/dialog/dialog.service';
// @ts-expect-error – Node built-in, only available in the test runner
import { readFileSync } from 'node:fs';
import { AboutDialog, aboutRows, aboutText } from './about-dialog';

const INFO: AppInfo = {
  name: 'Files and Folders',
  version: '0.1.0',
  crateVersion: '0.1.0',
  tauriVersion: '2.12.4',
  os: 'linux',
  arch: 'x86_64',
  debug: true,
};

describe('about rows', () => {
  it('shows version, build and platform', () => {
    const rows = aboutRows(INFO);
    expect(rows[0]).toEqual({ label: 'Version', value: '0.1.0' });
    expect(rows.find((r) => r.label === 'Build')?.value).toBe('development build');
    expect(rows.find((r) => r.label === 'Platform')?.value).toBe('Linux · x86_64');
    expect(aboutRows({ ...INFO, os: 'macos', debug: false })[2].value).toBe('macOS · x86_64');
  });

  it('flags drifted versions', () => {
    expect(aboutRows({ ...INFO, crateVersion: '0.0.9' })[0].value).toContain('0.0.9');
  });

  it('plain text for bug reports', () => {
    expect(aboutText(INFO)).toMatch(/^Files and Folders\nVersion: 0\.1\.0\n/);
  });
});

describe('version source of truth', () => {
  it('tauri.conf.json reads package.json', () => {
    const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    expect(conf.version).toBe('../package.json');
  });
});

describe('AboutDialog', () => {
  let copied: string[];
  let result: Promise<AppInfo>;

  beforeEach(() => {
    copied = [];
    result = Promise.resolve(INFO);
    TestBed.configureTestingModule({
      providers: [
        { provide: AboutApi, useValue: { getAppInfo: () => result } },
        {
          provide: ClipboardApi,
          useValue: { writeText: (t: string) => (copied.push(t), Promise.resolve()) },
        },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(AboutDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the version and copies the details', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="about-version"]')?.textContent).toContain('0.1.0');
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    const copy = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Copy')!;
    copy.click();
    await new Promise((r) => setTimeout(r));
    expect(copied[0]).toContain('Version: 0.1.0');
  });

  it('without backend: a hint, no crash', async () => {
    result = Promise.reject({ code: 'no_backend', message: 'x', path: null });
    const el = await render();
    expect(el.textContent).toContain('only available in the desktop app');
  });

  it('Close closes the dialog', async () => {
    const dialogs = TestBed.inject(DialogService);
    dialogs.show('about');
    const el = await render();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close')!.click();
    expect(dialogs.open()).toBeNull();
  });
});
