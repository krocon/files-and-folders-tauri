import type { Translation } from '../../core/i18n/i18n';
import type { SG_EN } from './series-texts';

const files = (n: number) => (n === 1 ? '1 Datei' : `${n} Dateien`);
const episodes = (n: number) => (n === 1 ? '1 Folge' : `${n} Folgen`);
const seasons = (n: number) => (n === 1 ? '1 Staffel' : `${n} Staffeln`);

/** Deutsche Texte des Dialogs „Serien nach Staffeln gruppieren“ (design 045). */
export const SG_DE: Translation<typeof SG_EN> = {
  title: (n, s) => `Serien nach Staffeln gruppieren – ${episodes(n)} in ${seasons(s)}`,
  titleScanning: 'Serien nach Staffeln gruppieren',
  template: 'Ordnername',
  custom: 'Eigene Vorlage…',
  customTemplate: 'Vorlage ({n} = 1, {nn} = 01)',
  target: 'Ziel',
  targets: {
    other: 'Ordner der anderen Seite',
    source: 'Der Serienordner selbst',
    otherSeries: 'Andere Seite + Ordner mit dem Seriennamen',
  },
  blockedMixed:
    'Mehrere Serien würden sich in denselben Staffelordnern mischen – „Andere Seite + Ordner mit dem Seriennamen“ oder „Der Serienordner selbst“ wählen.',
  blockedSeriesName: (name, why) => `„${name}“ geht nicht als Ordnername: ${why}`,
  seriesCount: (n) => `${n} Serienordner`,
  noOtherPanel: '(die andere Seite zeigt keinen Ordner)',
  subtitles: 'Untertitel mitnehmen',
  showIgnored: 'Ignorierte zeigen',
  videos: 'Videos',
  junk: 'Beiwerk (ignoriert)',
  junkDirs: 'Ordner',
  cleanup: 'Nach dem Verschieben die Release-Ordner aufräumen (Papierkorb, mit Vorschau)',
  preview: 'Vorschau',
  scanning: 'Sammle Dateien …',
  colNr: 'Nr.',
  colSource: 'Quelle',
  colSeason: 'Staffel',
  colEpisode: 'Folge',
  colTarget: 'Ziel',
  colInfo: 'Info',
  infoOk: 'OK',
  infoSubtitle: 'Untertitel',
  infoInPlace: 'schon im Staffelordner',
  infoCopied: (folder) => `schon in ${folder}`,
  infoUnrecognized: 'keine Staffel/Folge erkannt',
  infoJunkDir: (name) => `im Ordner ${name}`,
  infoJunk: 'Beiwerk',
  infoNotVideo: 'kein Video',
  infoDuplicate: 'Folge doppelt',
  infoInvalid: (why) => `ungültiger Ordnername: ${why}`,
  templateInvalid: 'Die Vorlage braucht {n} oder {nn}.',
  summary: (perSeason, ok, ignored, other) =>
    `${perSeason}${perSeason ? ' — ' : ''}${ok} zu gruppieren, ${ignored} ignoriert, ${other} sonstige`,
  hintGaps: (list) => `Fehlende Folgen: ${list}`,
  hintSeries: (names) => `Mehrere Serien in diesem Ordner: ${names}`,
  hintDuplicates: (n) => `${episodes(n)} doppelt gefunden (alle werden übernommen)`,
  hintTruncated: 'Nicht alles gelesen (zu viele Dateien oder Ordner).',
  hintUnreadable: (n) => `${n === 1 ? '1 Ordner' : `${n} Ordner`} nicht lesbar.`,
  cancel: 'Abbrechen',
  copy: 'Kopieren',
  move: 'Verschieben',
  noFolder: 'Diese Seite zeigt keinen lokalen Ordner',
  failed: (msg) => `Serien gruppieren fehlgeschlagen: ${msg}`,
  withErrors: (n) => `Serien gruppiert – ${files(n)} fehlgeschlagen`,
  done: (n) => `Serien gruppiert: ${files(n)}`,
};
