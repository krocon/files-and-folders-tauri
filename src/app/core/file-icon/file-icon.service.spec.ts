import { TestBed } from '@angular/core/testing';
import { dir, entry } from '../../../testing/fs-fixtures';
import { parentRow } from '../fs/fs.models';
import {
  extractExtension,
  FileIconService,
  iconFor,
  iconNameForEntry,
  iconNameForExtension,
} from './file-icon.service';

describe('FileIconService', () => {
  let service: FileIconService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FileIconService);
  });

  it('provides the 11 configured categories and extensions', () => {
    expect(service.categories).toHaveLength(11);
    const labels = service.categories.map((c) => c.label);
    expect(labels).toEqual([
      'movies',
      'audio',
      'images',
      'documents',
      'archives',
      'code',
      'executables',
      'fonts',
      'ebooks',
      'design',
      '3d',
    ]);
  });

  describe('extractExtension', () => {
    it('extracts extension from full file name', () => {
      expect(extractExtension('video.mp4')).toBe('mp4');
      expect(extractExtension('archive.tar.gz')).toBe('gz');
      expect(extractExtension('PHOTO.JPEG')).toBe('jpeg');
    });

    it('extracts extension from dot prefixed or raw extension string', () => {
      expect(extractExtension('.png')).toBe('png');
      expect(extractExtension('png')).toBe('png');
      expect(extractExtension(' .MP3 ')).toBe('mp3');
    });
  });

  describe('getCategory', () => {
    it('returns the category for given extensions', () => {
      expect(service.getCategory('movie.avi')).toBe('movies');
      expect(service.getCategory('.mp3')).toBe('audio');
      expect(service.getCategory('photo.png')).toBe('images');
      expect(service.getCategory('sheet.xlsx')).toBe('documents');
      expect(service.getCategory('backup.zip')).toBe('archives');
      expect(service.getCategory('index.ts')).toBe('code');
      expect(service.getCategory('app.exe')).toBe('executables');
      expect(service.getCategory('font.woff2')).toBe('fonts');
      expect(service.getCategory('book.epub')).toBe('ebooks');
      expect(service.getCategory('graphic.psd')).toBe('design');
      expect(service.getCategory('model.blend')).toBe('3d');
    });

    it('returns undefined for unknown extensions', () => {
      expect(service.getCategory('file.xyz')).toBeUndefined();
      expect(service.getCategory('noext')).toBeUndefined();
    });
  });

  describe('iconNameForExtension / getIconClass', () => {
    it('maps movie extensions to video icon', () => {
      for (const ext of ['.avi', '.mkv', '.mp4', '.mov', '.wmv', '.flv', '.webm']) {
        expect(iconNameForExtension(ext)).toBe('fa-file-video-o');
        expect(service.getIconClass(ext)).toBe('fa fa-file-video-o');
      }
    });

    it('maps audio extensions to audio icon', () => {
      for (const ext of ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.wma', '.m4a']) {
        expect(iconNameForExtension(ext)).toBe('fa-file-audio-o');
      }
    });

    it('maps image extensions to image icon', () => {
      for (const ext of [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.bmp',
        '.tiff',
        '.webp',
        '.svg',
        '.heic',
      ]) {
        expect(iconNameForExtension(ext)).toBe('fa-file-image-o');
      }
    });

    it('maps specific document extensions to specific icons', () => {
      expect(iconNameForExtension('.pdf')).toBe('fa-file-pdf-o');
      expect(iconNameForExtension('.doc')).toBe('fa-file-word-o');
      expect(iconNameForExtension('.docx')).toBe('fa-file-word-o');
      expect(iconNameForExtension('.odt')).toBe('fa-file-word-o');
      expect(iconNameForExtension('.rtf')).toBe('fa-file-word-o');
      expect(iconNameForExtension('.xls')).toBe('fa-file-excel-o');
      expect(iconNameForExtension('.xlsx')).toBe('fa-file-excel-o');
      expect(iconNameForExtension('.ods')).toBe('fa-file-excel-o');
      expect(iconNameForExtension('.ppt')).toBe('fa-file-powerpoint-o');
      expect(iconNameForExtension('.pptx')).toBe('fa-file-powerpoint-o');
      expect(iconNameForExtension('.odp')).toBe('fa-file-powerpoint-o');
      expect(iconNameForExtension('.txt')).toBe('fa-file-text-o');
      expect(iconNameForExtension('.md')).toBe('fa-file-text-o');
    });

    it('maps archives to archive icon', () => {
      for (const ext of ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso']) {
        expect(iconNameForExtension(ext)).toBe('fa-file-archive-o');
      }
    });

    it('maps code extensions to code icon', () => {
      for (const ext of [
        '.html',
        '.css',
        '.js',
        '.ts',
        '.jsx',
        '.tsx',
        '.py',
        '.java',
        '.c',
        '.cpp',
        '.cs',
        '.rb',
        '.php',
        '.go',
        '.rs',
        '.xml',
        '.json',
        '.yml',
        '.yaml',
        '.sql',
      ]) {
        expect(iconNameForExtension(ext)).toBe('fa-file-code-o');
      }
    });

    it('maps executables to cogs icon', () => {
      for (const ext of ['.exe', '.msi', '.bat', '.apk', '.app', '.jar', '.com', '.bin', '.cmd']) {
        expect(iconNameForExtension(ext)).toBe('fa-cogs');
      }
    });

    it('maps fonts to font icon', () => {
      for (const ext of ['.ttf', '.otf', '.woff', '.woff2', '.eot']) {
        expect(iconNameForExtension(ext)).toBe('fa-font');
      }
    });

    it('maps ebooks to book icon', () => {
      for (const ext of ['.epub', '.mobi', '.azw', '.azw3', '.fb2', '.cbz', '.cbr']) {
        expect(iconNameForExtension(ext)).toBe('fa-book');
      }
    });

    it('maps design files to paint brush icon', () => {
      for (const ext of ['.psd', '.ai', '.xd', '.sketch', '.fig', '.indd', '.cdr']) {
        expect(iconNameForExtension(ext)).toBe('fa-paint-brush');
      }
    });

    it('maps 3d files to cube icon', () => {
      for (const ext of ['.obj', '.fbx', '.stl', '.dae', '.3ds', '.blend']) {
        expect(iconNameForExtension(ext)).toBe('fa-cube');
      }
    });

    it('falls back to fa-file-o for unknown extensions', () => {
      expect(iconNameForExtension('unknown.foobar')).toBe('fa-file-o');
      expect(iconNameForExtension('plainfile')).toBe('fa-file-o');
    });
  });

  describe('iconFor / iconNameForEntry', () => {
    it('returns parent folder icon for parent row', () => {
      expect(iconNameForEntry(parentRow('/parent'))).toBe('fa-level-up');
      expect(iconFor(parentRow('/parent'))).toBe('fa fa-level-up');
    });

    it('returns folder icon for directories', () => {
      expect(iconNameForEntry(dir('my-folder'))).toBe('fa-folder');
      expect(iconFor(dir('my-folder'))).toBe('fa fa-folder');
    });

    it('handles symlinks correctly', () => {
      expect(iconNameForEntry(entry('dirlink', { kind: 'symlink', targetKind: 'directory' }))).toBe(
        'fa-folder',
      );
      expect(iconNameForEntry(entry('filelink.pdf', { kind: 'symlink', targetKind: 'file' }))).toBe(
        'fa-file-pdf-o',
      );
      expect(iconNameForEntry(entry('deadlink', { kind: 'symlink', targetKind: null }))).toBe(
        'fa-chain-broken',
      );
    });

    it('handles unknown kinds with question circle', () => {
      expect(iconNameForEntry(entry('weird', { kind: 'unknown' }))).toBe('fa-question-circle');
    });

    it('resolves file icons based on extension', () => {
      expect(iconFor(entry('song.flac'))).toBe('fa fa-file-audio-o');
      expect(iconFor(entry('code.rs'))).toBe('fa fa-file-code-o');
      expect(iconFor(entry('plain.unknown'))).toBe('fa fa-file-o');
    });
  });
});
