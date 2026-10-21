import { TestBed } from '@angular/core/testing';
import { SettingsApi } from '../core/settings/settings-api';
import { SettingsStore } from '../core/settings/settings.store';
import { FakeSettingsApi } from '../../testing/fake-settings-api';
import { DEFAULT_GROUP_OPTIONS, restoreGroupOptions } from '../features/groupfiles/group-engine';
import { DEFAULT_MKDIR, restoreMkdir } from '../features/multimkdir/mkdir-engine';
import { DEFAULT_CLEAN_FORM, restoreCleanForm } from '../features/cleanfolders/clean.store';
import { recallDialog, rememberDialog } from './dialog-memory';

describe('last inputs of the tool dialogs (design 027 E5)', () => {
  it('keeps one value per dialog, newest first, and reads it back', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: SettingsApi, useValue: new FakeSettingsApi() }],
    });
    const settings = TestBed.inject(SettingsStore);
    await settings.init();
    expect(recallDialog(settings, 'groupFiles')).toBeUndefined();
    rememberDialog(settings, 'groupFiles', { mode: 'firstWord' });
    rememberDialog(settings, 'clean', { junkOn: true });
    rememberDialog(settings, 'groupFiles', { mode: 'twoLetters' });
    expect(settings.get('dialogs.recent')).toEqual([
      { dialog: 'groupFiles', value: { mode: 'twoLetters' } },
      { dialog: 'clean', value: { junkOn: true } },
    ]);
    expect(recallDialog(settings, 'clean')).toEqual({ junkOn: true });
    // too big for the setting: the old value stays
    rememberDialog(settings, 'multiMkdir', { template: 'x'.repeat(20_000) });
    expect(recallDialog(settings, 'multiMkdir')).toBeUndefined();
  });

  it('restores only valid fields, the rest falls back to the defaults', () => {
    expect(restoreGroupOptions(null)).toEqual(DEFAULT_GROUP_OPTIONS);
    expect(
      restoreGroupOptions({
        mode: 'firstWord',
        minSize: 7,
        newFolder: 'Neu ä',
        ignoreBrackets: 'yes',
      }),
    ).toEqual({ ...DEFAULT_GROUP_OPTIONS, mode: 'firstWord', newFolder: 'Neu ä' });
    expect(
      restoreMkdir({ template: 'Ordner [C]', start: 3, step: 0, digits: 1.5, letterCase: 'upper' }),
    ).toEqual({ ...DEFAULT_MKDIR, template: 'Ordner [C]', start: 3, letterCase: 'upper' });
    expect(restoreCleanForm([1, 2])).toEqual(DEFAULT_CLEAN_FORM);
    expect(
      restoreCleanForm({ patternsOn: true, patternsText: '*.tmp; *.bak', mode: 'permanent' }),
    ).toEqual({
      ...DEFAULT_CLEAN_FORM,
      patternsOn: true,
      patternsText: '*.tmp; *.bak',
    });
  });
});
