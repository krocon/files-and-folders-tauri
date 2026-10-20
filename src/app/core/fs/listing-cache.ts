import { Injectable } from '@angular/core';
import { DirectoryListing } from './fs.models';

/** Listings that took at least this long are kept (design 030 E1). */
export const CACHE_SLOW_MS = 300;
/** Upper bound for all kept listings together, counted in entries. */
export const CACHE_MAX_ENTRIES = 200_000;

export interface CachedListing {
  readonly listing: DirectoryListing;
  /** Wall-clock time (ms) the listing was requested. */
  readonly listedAt: number;
}

/** Only slow or network folders are worth it; archives have their own cache in Rust. */
export function worthCaching(listing: DirectoryListing, durationMs: number): boolean {
  return !listing.archive && (listing.network === true || durationMs >= CACHE_SLOW_MS);
}

/**
 * Listings of slow folders (network drives, busy disks) for an instant way back
 * (design 030 E1/E2): a panel shows a hit at once, marked as not yet checked, and
 * reads the folder again in the background. In memory only, shared by both
 * panels, least recently used out first, bounded by the number of entries.
 */
@Injectable({ providedIn: 'root' })
export class ListingCache {
  /** Insertion order = use order (oldest first). */
  private readonly items = new Map<string, CachedListing>();
  private entries = 0;
  /** Bound in entries (tests lower it). */
  maxEntries = CACHE_MAX_ENTRIES;

  get(path: string): CachedListing | null {
    const hit = this.items.get(path);
    if (!hit) {
      return null;
    }
    // used: to the end of the queue
    this.items.delete(path);
    this.items.set(path, hit);
    return hit;
  }

  /** Stores a fresh listing – or forgets the folder if it is fast now. */
  remember(listing: DirectoryListing, listedAt: number, durationMs: number): void {
    this.forget(listing.path);
    if (!worthCaching(listing, durationMs) || listing.entries.length > this.maxEntries) {
      return;
    }
    this.items.set(listing.path, { listing, listedAt });
    this.entries += listing.entries.length;
    for (const [path, item] of this.items) {
      if (this.entries <= this.maxEntries) {
        break;
      }
      this.items.delete(path);
      this.entries -= item.listing.entries.length;
    }
  }

  /** Keeps a newer version of a kept folder (watcher deltas, folder sizes) – never adds one. */
  update(listing: DirectoryListing): void {
    const kept = this.items.get(listing.path);
    if (kept && kept.listing !== listing) {
      this.entries += listing.entries.length - kept.listing.entries.length;
      this.items.set(listing.path, { listing, listedAt: kept.listedAt });
    }
  }

  forget(path: string): void {
    const kept = this.items.get(path);
    if (kept) {
      this.items.delete(path);
      this.entries -= kept.listing.entries.length;
    }
  }

  /** Number of kept entries (tests, diagnostics). */
  size(): { folders: number; entries: number } {
    return { folders: this.items.size, entries: this.entries };
  }
}
