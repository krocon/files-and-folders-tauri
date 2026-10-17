import { Type } from '@angular/core';
import { Preview } from '../../core/preview/preview.models';
import { Match } from './text-search';
import { HexView } from './views/hex-view';
import { ImageView } from './views/image-view';
import { InfoView } from './views/info-view';
import { TextView } from './views/text-view';

/** What a preview view gets besides the preview (design 010 E7). */
export interface PreviewContext {
  /** Quick view: smaller, no search. */
  readonly compact: boolean;
  readonly wrap: boolean;
  readonly matches: readonly Match[];
  /** Index into `matches`, -1 = none. */
  readonly current: number;
  /** Image zoom: `fit` or a factor (1 = 100 %). */
  readonly zoom: 'fit' | number;
}

export const DEFAULT_CONTEXT: PreviewContext = {
  compact: false,
  wrap: false,
  matches: [],
  current: -1,
  zoom: 'fit',
};

/**
 * A view for some previews. Components take the inputs `preview` and `context`.
 * New formats (PDF, Markdown, audio/video) add a provider here – the first one
 * whose `canShow` is true wins.
 */
export interface PreviewProvider {
  readonly id: string;
  canShow(p: Preview): boolean;
  readonly component: Type<unknown>;
}

export const PREVIEW_PROVIDERS: readonly PreviewProvider[] = [
  { id: 'image', canShow: (p) => p.kind === 'image', component: ImageView },
  // Markdown, HTML and SVG sources are shown as text – never rendered
  { id: 'text', canShow: (p) => p.kind === 'text', component: TextView },
  { id: 'hex', canShow: (p) => p.kind === 'binary', component: HexView },
  { id: 'info', canShow: () => true, component: InfoView },
];

export function providerFor(
  p: Preview,
  providers: readonly PreviewProvider[] = PREVIEW_PROVIDERS,
): PreviewProvider {
  return providers.find((x) => x.canShow(p)) ?? providers[providers.length - 1];
}
