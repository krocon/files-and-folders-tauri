import { entry, listing } from '../../../testing/fs-fixtures';
import { DirectoryListing } from './fs.models';
import { CACHE_SLOW_MS, ListingCache, worthCaching } from './listing-cache';

function big(path: string, n: number, network = false): DirectoryListing {
  const entries = Array.from({ length: n }, (_, i) => entry(`f${i}`, { path: `${path}/f${i}` }));
  return { ...listing(path, entries), network };
}

describe('ListingCache (design 030 E1)', () => {
  it('keeps only slow or network folders, never archives', () => {
    const l = listing('/a', []);
    expect(worthCaching(l, CACHE_SLOW_MS - 1)).toBe(false);
    expect(worthCaching(l, CACHE_SLOW_MS)).toBe(true);
    expect(worthCaching({ ...l, network: true }, 0)).toBe(true);
    expect(
      worthCaching(
        {
          ...l,
          archive: { path: '/a.zip', inner: '', format: 'zip', unsafeEntries: 0, entries: 0 },
        },
        5000,
      ),
    ).toBe(false);
  });

  it('forgets a folder that became fast, and keeps newer versions only of kept ones', () => {
    const c = new ListingCache();
    c.remember(big('/smb/ä', 3, true), 1, 10);
    expect(c.get('/smb/ä')?.listedAt).toBe(1);
    c.update(big('/smb/ä', 5, true));
    expect(c.size()).toEqual({ folders: 1, entries: 5 });
    expect(c.get('/smb/ä')?.listedAt).toBe(1);
    c.update(big('/local', 2));
    expect(c.get('/local')).toBeNull();
    c.remember(big('/smb/ä', 3), 2, 5);
    expect(c.get('/smb/ä')).toBeNull();
    expect(c.size()).toEqual({ folders: 0, entries: 0 });
  });

  it('drops the least recently used folders beyond the entry limit', () => {
    const c = new ListingCache();
    c.maxEntries = 10;
    c.remember(big('/a', 4, true), 1, 0);
    c.remember(big('/b', 4, true), 1, 0);
    c.get('/a'); // used: /b is the oldest now
    c.remember(big('/c', 4, true), 1, 0);
    expect(c.get('/b')).toBeNull();
    expect(c.get('/a')).not.toBeNull();
    expect(c.get('/c')).not.toBeNull();
    expect(c.size().entries).toBe(8);
    // one folder bigger than the whole cache is not kept
    c.remember(big('/huge', 11, true), 1, 0);
    expect(c.get('/huge')).toBeNull();
  });
});
