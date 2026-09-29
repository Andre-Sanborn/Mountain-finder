/**
 * Locating the EXIF block inside a HEIF/HEIC container.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — A LIBRARY THAT SAYS "NO EXIF" WHEN IT MEANS "I GAVE UP"
 * ═══════════════════════════════════════════════════════════════════════════
 * `exifr` reads HEIC, and this module would be pure duplication if it read all
 * of it. It does not. Its container check is:
 *
 *     let size = file.getUint16(2);     // low half of the ftyp box size
 *     if (size > 50) return false;      // <- an arbitrary cap
 *
 * Every iPhone photograph carrying an HDR **gain map** — compatible brands
 * `mif1 MiHB MiHA heix …` — has a 52-byte `ftyp` box and is refused by that
 * line. Refused, not failed: no parser claims the file, `exifr.parse` throws
 * `Unknown file format`, and the caller's natural handling of that is to report
 * a photograph with no metadata.
 *
 * Measured on the nine HEIC originals in `fixtures/photos/real/`:
 *
 *     ftyp 44 bytes   the three railroad-ridge frames   read correctly
 *     ftyp 52 bytes   the other six                     REFUSED — "no EXIF"
 *
 * Six of nine, and nothing about the refused ones is unusual: they are
 * ordinary photographs from a recent iPhone with HDR on, which is the default.
 *
 * That failure is the worst shape this project recognises. A photograph whose
 * GPS was stripped by a share sheet and a photograph whose GPS is sitting in
 * the file unread produce **identical** output, so the app would tell someone
 * to type in a position it was holding all along. `extract.ts` cannot tell the
 * two apart from `{}`; this module makes it able to.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT DOES
 * ═══════════════════════════════════════════════════════════════════════════
 * Walks the ISO base media file format (ISO/IEC 14496-12) far enough to find
 * one thing — the item whose type is `Exif` — and returns the TIFF block it
 * points at, for exifr's TIFF parser to read. It decodes no pixels, follows no
 * construction methods other than the file-offset one, and returns `undefined`
 * rather than a guess at every point where the container says something this
 * code does not understand.
 *
 * Structures used, and nothing else:
 *
 *   ftyp   major brand and compatible brands — is this HEIF at all
 *   meta   FullBox holding the item metadata
 *   iinf   item information: which item id is the `Exif` one (`infe` v2+)
 *   iloc   item location: where that id's bytes are, as offset + length
 *
 * The item payload is an `ExifDataBlock`: a 4-byte offset to the TIFF header,
 * then the TIFF block. The offset is normally 0 or 6 — the latter when the
 * block is prefixed `Exif\0\0` — and rather than trust it blindly the result is
 * checked for a TIFF byte-order mark, since a wrong offset here would hand
 * exifr the middle of a structure and produce plausible nonsense.
 */

/** Four-character box type, as it appears in the file. */
type BoxType = string;

interface Box {
  readonly type: BoxType;
  /** Offset of the box's first content byte. */
  readonly start: number;
  /** Offset one past the box's last content byte. */
  readonly end: number;
  /** Offset of the box header's first byte — needed for `iloc` base offsets. */
  readonly headerStart: number;
}

/** Why a HEIF file yielded no EXIF. Never conflated with "it carries none". */
export type HeifExifFailure =
  | 'not-heif'
  | 'no-meta-box'
  | 'no-item-info'
  | 'no-exif-item'
  | 'no-item-location'
  | 'unsupported-construction-method'
  | 'extent-out-of-bounds'
  | 'not-tiff';

export interface HeifExifResult {
  /** The TIFF block, ready for a TIFF parser. Absent when `failure` is set. */
  readonly tiff?: Uint8Array;
  readonly failure?: HeifExifFailure;
  /** Brands from the `ftyp` box, for diagnostics. Empty when not HEIF. */
  readonly brands: readonly string[];
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[at + index] ?? 0);
  }
  return text;
}

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32(bytes: Uint8Array, at: number): number {
  // `>>> 0` because the top bit of a box size would otherwise come out
  // negative, and a negative length silently walks the parser backwards.
  return (
    (((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0)) >>>
    0
  );
}

/**
 * An unsigned big-endian integer of 0, 4 or 8 bytes — the sizes `iloc` uses.
 *
 * 8-byte values are read through `Number`, which is exact below 2^53. A HEIF
 * file large enough to need more than that is not a photograph.
 */
function uintBytes(bytes: Uint8Array, at: number, size: number): number {
  if (size === 0) return 0;
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value = value * 256 + (bytes[at + index] ?? 0);
  }
  return value;
}

/**
 * The boxes directly inside `[start, end)`.
 *
 * A box whose declared size does not advance the cursor ends the walk: a zero
 * or negative step is a malformed file, and looping on it forever is the one
 * behaviour worse than refusing.
 */
function boxesIn(bytes: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const headerStart = offset;
    let size = u32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    let headerLength = 8;
    if (size === 1) {
      // 64-bit `largesize` follows the type.
      if (offset + 16 > end) break;
      size = uintBytes(bytes, offset + 8, 8);
      headerLength = 16;
    } else if (size === 0) {
      // Runs to the end of the enclosing box.
      size = end - offset;
    }
    if (size < headerLength || offset + size > end) break;
    boxes.push({ type, start: offset + headerLength, end: offset + size, headerStart });
    offset += size;
  }
  return boxes;
}

function findBox(boxes: readonly Box[], type: BoxType): Box | undefined {
  return boxes.find((box) => box.type === type);
}

/** A FullBox's version and flags, and the offset of its first content byte. */
function fullBoxHead(bytes: Uint8Array, box: Box): { version: number; body: number } {
  return { version: bytes[box.start] ?? 0, body: box.start + 4 };
}

/** The brands in the `ftyp` box: major brand first, then the compatible ones. */
export function heifBrands(bytes: Uint8Array): readonly string[] {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp') return [];
  const size = u32(bytes, 0);
  if (size < 16 || size > bytes.length) return [];
  const brands = [ascii(bytes, 8, 4)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(bytes, at, 4));
  return brands;
}

/**
 * Whether these bytes are a HEIF-family container.
 *
 * Deliberately generous, and deliberately NOT size-capped: the whole reason
 * this module exists is a hard limit on how long a `ftyp` box may be. A file
 * that says it is HEIF is treated as HEIF, and if its contents then make no
 * sense the failure is named rather than reported as "no metadata".
 */
export function isHeif(bytes: Uint8Array): boolean {
  const brands = heifBrands(bytes);
  if (brands.length === 0) return false;
  const known = new Set([
    'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs',
    'mif1', 'msf1', 'miaf', 'avif', 'avis',
  ]);
  return brands.some((brand) => known.has(brand));
}

/** The item id whose `infe` declares `item_type == 'Exif'`. */
function exifItemId(bytes: Uint8Array, meta: Box): number | undefined {
  const iinf = findBox(boxesIn(bytes, meta.start + 4, meta.end), 'iinf');
  if (iinf === undefined) return undefined;

  const { version, body } = fullBoxHead(bytes, iinf);
  // entry_count is 16-bit in version 0 and 32-bit from version 1.
  const entriesStart = version === 0 ? body + 2 : body + 4;

  for (const infe of boxesIn(bytes, entriesStart, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const head = fullBoxHead(bytes, infe);
    // item_type only exists from version 2. Versions 0 and 1 describe items by
    // MIME type in a different layout and no iPhone writes them; rather than
    // guess at a layout this code cannot test, they are skipped.
    if (head.version < 2) continue;
    const idSize = head.version === 2 ? 2 : 4;
    const itemId = idSize === 2 ? u16(bytes, head.body) : u32(bytes, head.body);
    // item_ID, item_protection_index, then the four-character item_type.
    const itemType = ascii(bytes, head.body + idSize + 2, 4);
    if (itemType === 'Exif') return itemId;
  }
  return undefined;
}

/** Byte range of one item, from `iloc`. */
function itemExtent(
  bytes: Uint8Array,
  meta: Box,
  wantedId: number,
): { offset: number; length: number } | HeifExifFailure {
  const iloc = findBox(boxesIn(bytes, meta.start + 4, meta.end), 'iloc');
  if (iloc === undefined) return 'no-item-location';

  const { version, body } = fullBoxHead(bytes, iloc);
  const sizes = bytes[body] ?? 0;
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0x0f;
  const baseSizes = bytes[body + 1] ?? 0;
  const baseOffsetSize = baseSizes >> 4;
  // The low nibble is index_size from version 1, reserved in version 0.
  const indexSize = version >= 1 ? baseSizes & 0x0f : 0;

  let at = body + 2;
  const itemCount = version < 2 ? u16(bytes, at) : u32(bytes, at);
  at += version < 2 ? 2 : 4;

  for (let index = 0; index < itemCount; index += 1) {
    const itemId = version < 2 ? u16(bytes, at) : u32(bytes, at);
    at += version < 2 ? 2 : 4;

    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = (bytes[at + 1] ?? 0) & 0x0f;
      at += 2;
    }
    at += 2; // data_reference_index
    const baseOffset = uintBytes(bytes, at, baseOffsetSize);
    at += baseOffsetSize;
    const extentCount = u16(bytes, at);
    at += 2;

    for (let extent = 0; extent < extentCount; extent += 1) {
      at += indexSize;
      const extentOffset = uintBytes(bytes, at, offsetSize);
      at += offsetSize;
      const extentLength = uintBytes(bytes, at, lengthSize);
      at += lengthSize;

      if (itemId !== wantedId || extent > 0) continue;
      // 0 = the offset is into this file. 1 (idat) and 2 (another item) are
      // legal and neither is used for EXIF by any writer this handles; a
      // wrong assumption here would slice bytes from the wrong place and
      // hand a parser something that might still look like a TIFF.
      if (constructionMethod !== 0) return 'unsupported-construction-method';
      return { offset: baseOffset + extentOffset, length: extentLength };
    }
  }
  return 'no-exif-item';
}

/** TIFF byte-order marks: `II*\0` little-endian, `MM\0*` big-endian. */
function tiffStartsAt(bytes: Uint8Array, at: number): boolean {
  const mark = ascii(bytes, at, 2);
  if (mark === 'II') return u16(bytes, at + 2) === 0x2a00 || bytes[at + 2] === 0x2a;
  if (mark === 'MM') return bytes[at + 3] === 0x2a;
  return false;
}

/**
 * Find the TIFF/EXIF block inside a HEIF container.
 *
 * Returns the block, or a named reason. Never returns an empty result that a
 * caller could read as "this photograph carries no metadata".
 */
export function findHeifExif(bytes: Uint8Array): HeifExifResult {
  const brands = heifBrands(bytes);
  if (!isHeif(bytes)) return { failure: 'not-heif', brands };

  const meta = findBox(boxesIn(bytes, 0, bytes.length), 'meta');
  if (meta === undefined) return { failure: 'no-meta-box', brands };

  const itemId = exifItemId(bytes, meta);
  if (itemId === undefined) {
    const hasIinf =
      findBox(boxesIn(bytes, meta.start + 4, meta.end), 'iinf') !== undefined;
    return { failure: hasIinf ? 'no-exif-item' : 'no-item-info', brands };
  }

  const extent = itemExtent(bytes, meta, itemId);
  if (typeof extent === 'string') return { failure: extent, brands };
  if (extent.offset + extent.length > bytes.length || extent.length < 8) {
    return { failure: 'extent-out-of-bounds', brands };
  }

  // ExifDataBlock: a 4-byte offset from the end of that field to the TIFF
  // header, then the block itself. Usually 0; 6 when prefixed `Exif\0\0`.
  const headerOffset = u32(bytes, extent.offset);
  const declared = extent.offset + 4 + headerOffset;
  const start = tiffStartsAt(bytes, declared)
    ? declared
    : // The declared offset did not land on a byte-order mark. Rather than
      // slice from it anyway — which yields a parseable-looking structure read
      // from the wrong place — look for the mark within the field the block
      // could occupy, and refuse if it is not there.
      (() => {
        const limit = Math.min(extent.offset + 4 + 64, extent.offset + extent.length - 8);
        for (let at = extent.offset + 4; at <= limit; at += 1) {
          if (tiffStartsAt(bytes, at)) return at;
        }
        return -1;
      })();

  if (start < 0) return { failure: 'not-tiff', brands };
  return { tiff: bytes.subarray(start, extent.offset + extent.length), brands };
}
