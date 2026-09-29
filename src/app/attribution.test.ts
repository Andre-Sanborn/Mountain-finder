/**
 * Attribution derivation — unit tests.
 *
 * Two halves, deliberately:
 *
 *   1. The derivation, against hand-written citations whose expected output is
 *      written out in full. These prove the RULES: which licence is recognised,
 *      what is never invented, and that a differently-licensed dataset changes
 *      what the app says.
 *   2. The derivation over the citations this repository actually ships
 *      (`APP_DATA_USES`). This is the compliance test: the app must name
 *      OpenStreetMap and ODbL-1.0 for the Overture summits, because that
 *      licence requires the notice to reach users. It reads the same files the
 *      packaging step writes `dist/ATTRIBUTION.txt` from, so the two cannot
 *      disagree about what is shipped.
 *
 * Expectations are written from the licences and from the citation strings, not
 * captured from a run.
 */

import { describe, expect, it } from 'vitest';

import {
  attributionText,
  creditLine,
  deriveCredit,
  deriveCredits,
  detectHolders,
  detectLicence,
  obligationNote,
  publisherOf,
  type CitationRecord,
  type DataUse,
} from './attribution';
import { APP_DATA_USES, citationsOf, summariseRegions, summitCountOf } from './data-credits';

/** The Overture citation, shortened but word-for-word in the parts that matter. */
const OVERTURE: CitationRecord = {
  title:
    'Overture Maps Foundation, base theme, type=land, release 2026-06-17.0 — summit features ' +
    '(subtype=physical, class=peak|volcano), © OpenStreetMap contributors, ODbL-1.0',
  url: 'https://overturemaps-us-west-2.s3.amazonaws.com/release/2026-06-17.0/theme=base/type=land/',
};

const WIKIPEDIA: CitationRecord = {
  title: 'Matterhorn — Wikipedia',
  url: 'https://en.wikipedia.org/wiki/Matterhorn',
  note: 'Read via the web-search index.',
};

describe('detectLicence', () => {
  it('reads ODbL-1.0 out of a citation that names it', () => {
    const licence = detectLicence(OVERTURE);
    expect(licence?.id).toBe('ODbL-1.0');
    expect(licence?.requiresNotice).toBe(true);
    expect(licence?.url).toBe('https://opendatacommons.org/licenses/odbl/1-0/');
  });

  it('never invents a version the citation does not state', () => {
    // "ODbL" with no version is ODbL, not ODbL-1.0. A licence id is a legal
    // claim; guessing the version would be making one up.
    expect(detectLicence({ title: 'Some gazetteer, ODbL' })?.id).toBe('ODbL');
  });

  it('treats public-domain terms as courtesy rather than obligation', () => {
    const licence = detectLicence({ title: 'NASA/USGS SRTM 1 arc-second, public domain' });
    expect(licence?.id).toBe('public domain');
    expect(licence?.requiresNotice).toBe(false);
  });

  it('claims no licence for a citation that names none', () => {
    expect(detectLicence(WIKIPEDIA)).toBeUndefined();
  });

  it('prefers the more specific licence when two ids share a prefix', () => {
    expect(detectLicence({ title: 'Somewhere, CC-BY-SA-4.0' })?.id).toBe('CC-BY-SA-4.0');
    expect(detectLicence({ title: 'Somewhere, CC-BY-4.0' })?.id).toBe('CC-BY-4.0');
  });
});

describe('detectHolders and publisherOf', () => {
  it('takes the holder from the © clause and stops before the licence', () => {
    expect(detectHolders(OVERTURE)).toEqual(['OpenStreetMap contributors']);
  });

  it('finds no holder where the citation names none', () => {
    expect(detectHolders(WIKIPEDIA)).toEqual([]);
  });

  it('takes the publisher from the first clause of the title', () => {
    expect(publisherOf(OVERTURE)).toBe('Overture Maps Foundation');
  });
});

describe('creditLine', () => {
  it('renders an OSM-derived credit the conventional way', () => {
    const credit = deriveCredit({
      what: 'Summits',
      detail: '1 786 summits',
      sources: [OVERTURE],
    });
    // Exactly the sentence docs/DEPLOY.md says a deployment owes its users.
    expect(creditLine(credit)).toBe(
      '© OpenStreetMap contributors, ODbL-1.0, via Overture Maps Foundation',
    );
    expect(credit.noticeRequired).toBe(true);
    expect(obligationNote(credit)).toBe('Attribution required by ODbL-1.0.');
  });

  it('leads with the publisher when nobody holds copyright', () => {
    const credit = deriveCredit({
      what: 'Elevation',
      detail: 'terrain horizon',
      sources: [{ title: 'NASA/USGS SRTM 1 arc-second, via AWS Open Data, public domain' }],
    });
    expect(creditLine(credit)).toBe('NASA/USGS SRTM 1 arc-second — public domain');
    expect(credit.noticeRequired).toBe(false);
    expect(obligationNote(credit)).toBe('Credit is courtesy, not a condition.');
  });

  it('falls back to hostnames for cited facts, and lists no article titles', () => {
    const credit = deriveCredit({
      what: 'Summits',
      detail: '15 cited summits',
      sources: [WIKIPEDIA, { title: 'Ben Nevis — Wikipedia', url: 'https://en.wikipedia.org/wiki/Ben_Nevis' }],
    });
    expect(creditLine(credit)).toBe('en.wikipedia.org');
    expect(credit.publishers).toEqual([]);
    expect(obligationNote(credit)).toBe('Cited facts, no licence attached — credit is courtesy.');
  });

  it('follows the data: a differently-licensed region credits differently', () => {
    // The point of deriving rather than hard-coding. Nothing about this
    // citation is in the app; the licence table reads it out of the string.
    const credit = deriveCredit({
      what: 'Summits',
      detail: 'a future region',
      sources: [
        {
          title: 'Instituto Geográfico Nacional, summits, © IGN, CC-BY-4.0',
          url: 'https://www.ign.es/',
        },
      ],
    });
    expect(creditLine(credit)).toBe('© IGN, CC-BY-4.0, via Instituto Geográfico Nacional');
    expect(credit.links.map((link) => link.label)).toEqual(['CC-BY-4.0']);
  });

  it('takes the strictest licence when one body of data mixes them', () => {
    const mixed: DataUse = {
      what: 'Summits',
      detail: 'two regions',
      sources: [{ title: 'A gazetteer, CC0' }, OVERTURE],
    };
    const credit = deriveCredit(mixed);
    expect(credit.licence?.id).toBe('ODbL-1.0');
    expect(credit.noticeRequired).toBe(true);
  });
});

describe('the citations this build actually ships', () => {
  const credits = deriveCredits(APP_DATA_USES);
  const text = attributionText(credits);

  it('names OpenStreetMap and ODbL-1.0 for the Overture summits', () => {
    // The compliance assertion. ODbL-1.0 requires the notice to reach users;
    // this is the text the footer renders.
    expect(text).toContain('OpenStreetMap');
    expect(text).toContain('ODbL-1.0');
    const odbl = credits.filter((credit) => credit.licence?.id === 'ODbL-1.0');
    expect(odbl.length).toBeGreaterThan(0);
    for (const credit of odbl) {
      expect(credit.holders).toContain('OpenStreetMap contributors');
      expect(credit.publishers).toContain('Overture Maps Foundation');
      expect(credit.noticeRequired).toBe(true);
      expect(credit.links.map((link) => link.url)).toContain(
        'https://opendatacommons.org/licenses/odbl/1-0/',
      );
      expect(credit.links.map((link) => link.url)).toContain(
        'https://www.openstreetmap.org/copyright',
      );
    }
  });

  it('puts the credit a licence REQUIRES ahead of the courtesies', () => {
    // What survives a clipped footer has to be the obligation.
    expect(credits[0]?.noticeRequired).toBe(true);
    expect(credits[0]?.licence?.id).toBe('ODbL-1.0');
    expect(credits.slice(1).some((credit) => credit.noticeRequired)).toBe(false);
  });

  it('credits the elevation source as courtesy, not obligation', () => {
    const elevation = credits.filter((credit) => credit.what === 'Elevation');
    expect(elevation).toHaveLength(1);
    const [credit] = elevation;
    expect(credit?.noticeRequired).toBe(false);
    expect(creditLine(credit ?? credits[0] ?? ({} as never))).toContain('SRTM');
    expect(text).toContain('public domain');
  });

  it('says of every credit whether it is required or courtesy, in words', () => {
    for (const credit of credits) {
      const note = obligationNote(credit);
      expect(note === '' ? 'empty' : note).toMatch(/required|courtesy/);
    }
  });

  it('counts the committed regions and their summits from the region indexes', () => {
    // Derived, not frozen. An earlier version asserted the exact list
    // ['california','cascades','fort-william','zermatt'] and the exact total 8528,
    // and broke the moment a fifth region (idaho-central) was imported — a test
    // failing because the data grew, not because the code regressed.
    //
    // What is actually worth asserting is the AGGREGATION: that the footer's
    // total is the sum of what each region index states about itself, and that
    // the regions it names are the ones on disk. Those hold however many
    // regions exist.
    const indexes = import.meta.glob('../../fixtures/peaks/regions/*/index.json', {
      eager: true,
      import: 'default',
    });
    const regions = summariseRegions(indexes);

    const onDisk = Object.keys(indexes)
      .map((path) => path.split('/').at(-2))
      .filter((name): name is string => name !== undefined)
      .sort();
    expect(regions.names).toEqual(onDisk);
    expect(regions.names.length).toBeGreaterThanOrEqual(4);

    // The aggregate must equal the sum of each index's own declared total.
    const declared = Object.values(indexes).reduce<number>((total, index) => {
      const peaks = (index as { peakCount?: number }).peakCount;
      return total + (typeof peaks === 'number' ? peaks : 0);
    }, 0);
    expect(regions.summits).toBe(declared);
    expect(regions.summits).toBeGreaterThan(8000);
    // One citation, shared by all four regions — deduplicated by title, so the
    // footer states the Overture release once rather than four times.
    // One citation per Overture release the committed regions were cut from:
    // five regions from 2026-06-17.0, idaho-bogus-basin from 2026-09-23.1.
    expect(regions.citations).toHaveLength(2);
  });

  it('reads the bundled dataset’s own citations, not a copy of them', () => {
    const bundled = credits.find(
      (credit) => credit.what === 'Summits' && credit.origins.includes('en.wikipedia.org'),
    );
    expect(bundled).toBeDefined();
    expect(bundled?.detail).toContain('cited summits');
    expect(bundled?.noticeRequired).toBe(false);
  });
});

describe('citationsOf / summitCountOf', () => {
  it('ignores malformed entries rather than throwing in a footer', () => {
    expect(citationsOf(undefined)).toEqual([]);
    expect(citationsOf({ sources: 'nope' })).toEqual([]);
    expect(citationsOf({ sources: [null, { title: '' }, { title: 'Real, ODbL-1.0' }] })).toEqual([
      { title: 'Real, ODbL-1.0' },
    ]);
  });

  it('counts summits from a peak list or from a stated total', () => {
    expect(summitCountOf({ peaks: [{}, {}, {}] })).toBe(3);
    expect(summitCountOf({ peakCount: 1786 })).toBe(1786);
    expect(summitCountOf({})).toBe(0);
  });
});
