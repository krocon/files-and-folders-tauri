import { translatable } from '../../core/i18n/i18n';
import {
  FileActionProblemCode,
  FileActionTrigger,
} from '../../core/fileactions/file-actions.models';
import { FILE_ACTIONS_DE } from './file-actions-texts.de';

/** Texts of the double-click actions (design 072). */
export const FILE_ACTIONS_EN = {
  title: 'Double-click actions',
  intro:
    'What a double click on a matching file does instead of opening it. The first matching rule from the top wins. Nothing runs through a shell – every word of the command is one argument. It runs in the background unless you choose a terminal window.',
  rules: 'Rules',
  noRules: 'No rules yet – add one with the button below.',
  listHelp: 'Alt+↑/↓ move, Delete removes.',
  add: 'Add',
  remove: 'Remove',
  moveUp: 'Up',
  moveDown: 'Down',
  newPattern: '(no pattern)',
  noSelection: 'Choose a rule on the left or add one.',
  trigger: 'Trigger',
  triggers: { doubleClick: 'Double click' } as Readonly<Record<FileActionTrigger, string>>,
  pattern: 'File pattern',
  patternHelp:
    'For example *.js – several separated by ; or spaces, upper/lower case does not matter.',
  confirm: 'Ask before running',
  terminal: 'Run in a terminal window',
  command: 'Command',
  commandHelp:
    'For example node %N – runs in the folder of the file. %N or %name name of the file · %P%N full path · %O name without extension · %E extension · %T folder of the other panel · %% a percent sign. Quotes group words.',
  problems: {
    pattern: 'The file pattern is empty.',
    program:
      'The command must start with a program name or an absolute path, without placeholders.',
    params_quote: 'A quote in the command is not closed.',
    params_files: '%S must be a word of its own.',
    too_long: 'The command has too many words.',
  } as Readonly<Record<FileActionProblemCode, string>>,
  fixProblems: 'Please fix the marked rules first.',
  help: 'Help',
  cancel: 'Cancel',
  save: 'Save',
  saveFailed: (reason: string) => `Saving failed: ${reason}`,
  loadFailed: (reason: string) => `The double-click actions could not be loaded: ${reason}`,
  confirmTitle: 'Run command?',
  confirmRun: 'Run',
  started: (command: string, name: string) => `${command} started for ${name}`,
  helpContent: {
    title: 'Help: double-click actions',
    close: 'Close',
    howHeading: 'How it works',
    how: 'A double click on a file goes through the rules from the top. The first one whose pattern matches runs its command instead of opening the file. If none matches, the file opens as usual. Folders, archives, server folders and the duplicates view are never affected, and Enter always opens the file normally.',
    fieldsHeading: 'Fields',
    fields: [
      { term: 'Trigger', text: 'What sets the rule off. For now this is the double click.' },
      {
        term: 'File pattern',
        text: 'Compared with the file name: * stands for any text, ? for one character. Several patterns: *.js;*.mjs. Upper and lower case do not matter.',
      },
      {
        term: 'Ask before running',
        text: 'Shows the command and the file first. Enter means Cancel there: it only runs through the red button.',
      },
      {
        term: 'Run in a terminal window',
        text: 'Opens Terminal (macOS), cmd (Windows) or your terminal program (Linux; $TERMINAL comes first). You see the output and can answer questions; afterwards the window stays open with a prompt in the folder of the file. Without this option the program runs invisibly and only a failed start is reported.',
      },
      {
        term: 'Command',
        text: 'The program first, then its arguments. The program is a name found in PATH or a full path; ~ is your home folder. It runs in the folder of the file.',
      },
    ],
    placeholdersHeading: 'Placeholders',
    placeholdersIntro:
      'For the file /home/marc/docs/report final.js with /backup in the other panel:',
    placeholders: [
      'Name of the file',
      'Full path',
      'Name without extension',
      'Extension without the dot',
      'Folder of the file',
      'Folder of the other panel',
      'A percent sign',
    ],
    placeholdersNote: 'A name with spaces stays one argument, so it needs no quotes.',
    examplesHeading: 'Examples',
    examples: [
      'Runs a script; with a terminal window you see what it prints.',
      'A fixed argument after the file.',
      'Creates report final.mp3 next to the file.',
      'Copies the file to the other panel.',
    ],
    limitsHeading: 'Limits',
    limits:
      'Commands do not run through a shell, so |, && and > are passed on as plain text. For those, write a small script and run the script. Double quotes group several words into one argument. On Windows, a double quote cannot be passed on in a terminal window.',
  },
};

export const FILE_ACTIONS_TEXTS = translatable('fileActions', FILE_ACTIONS_EN, {
  de: FILE_ACTIONS_DE,
});
