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
    const kept = this.items.get(listing.path);
    // an older answer (the other panel's slower request) never replaces a newer one (review #8)
    if (kept && kept.listedAt > listedAt) {
      return;
    }
    this.forget(listing.path);
    if (!worthCaching(listing, durationMs) || weight(listing) > this.maxEntries) {
      return;
    }
    this.items.set(listing.path, { listing, listedAt });
    this.entries += weight(listing);
    this.evict();
  }

  /**
   * Keeps the newest state of a kept folder a panel shows (watcher deltas, folder
   * sizes) – never adds one. `basedOn`: when the panel's listing was read; an older
   * one does not replace the cache's (review #8).
   */
  update(listing: DirectoryListing, basedOn: number | null): void {
    const kept = this.items.get(listing.path);
    if (!kept || kept.listing === listing || (basedOn !== null && basedOn < kept.listedAt)) {
      return;
    }
    this.entries += weight(listing) - weight(kept.listing);
    // shown = used: to the end of the queue, so it is not the one evicted
    this.items.delete(listing.path);
    this.items.set(listing.path, { listing, listedAt: kept.listedAt });
    this.evict();
  }

  forget(path: string): void {
    const kept = this.items.get(path);
    if (kept) {
      this.items.delete(path);
      this.entries -= weight(kept.listing);
    }
  }

  private evict(): void {
    for (const [path, item] of this.items) {
      if (this.entries <= this.maxEntries) {
        break;
      }
      this.items.delete(path);
      this.entries -= weight(item.listing);
    }
  }

  /** Number of kept entries (tests, diagnostics). */
  size(): { folders: number; entries: number } {
    return { folders: this.items.size, entries: this.entries };
  }
}

/** An empty folder still counts – no unbounded number of empty listings (review #9). */
function weight(listing: DirectoryListing): number {
  return Math.max(1, listing.entries.length);
}
