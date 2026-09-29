/**
 * Getting a field bundle off the phone — the JSON and its frames together, by
 * the person's own action only.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO UPLOAD, EVER
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTS.md § "Captures from the phone": *"A capture bundle travels only by the
 * human's own action, to their own account."* So this module has no `fetch`, no
 * `XMLHttpRequest` and no URL of its own, exactly as `home-session-share.ts` has
 * none. There are two ways out and no third:
 *
 *   Web Share with a LIST of files. iOS shows the system share sheet and the
 *   person picks Mail, Files or AirDrop. The page never learns which.
 *   One download per file, when the browser has no file share.
 *
 * `navigator.share` must be called from inside a user gesture, so it is invoked
 * straight from the Share button's handler with no `await` before it.
 *
 * ── WHY THE FRAMES TRAVEL WITH THE BUNDLE, NOT INSIDE IT ───────────────────
 * A capture names its frame by a bare file name, and the parser refuses any
 * string long enough to hide an encoded image. So the bundle stays small and
 * readable, and the frames are ordinary JPEGs the person can look at before
 * deciding where to send them. They must arrive together: a bundle whose frames
 * were left behind cannot be graded, because truth is a pixel in the frame.
 *
 * ── SHARING TEXT IS NOT A FALLBACK ─────────────────────────────────────────
 * `navigator.share({ text })` exists everywhere `share` does, and it would drop
 * every photograph without saying so. A platform that cannot share files gets
 * the downloads instead, and the screen says which of the two happened.
 */

import type { ShareOutcome, ShareResult } from './home-session-share';

/** MIME type the bundle is offered as. */
export const BUNDLE_MIME = 'application/json';

/** MIME type a stored camera frame is offered as. */
export const FRAME_MIME = 'image/jpeg';

/**
 * One file being handed over.
 *
 * `body` is the JSON text for the bundle and the encoded bytes for a frame. The
 * two are kept in one type so the share sheet is handed one list, in one call,
 * from one gesture.
 */
export interface ShareableFile {
  readonly name: string;
  readonly mime: string;
  readonly body: string | Blob;
}

/**
 * What the two routes need from the platform.
 *
 * Injected as functions rather than reached for through `window`, so the choice
 * between them is testable with no DOM and the e2e can stub the share sheet
 * without touching this module.
 */
export interface BundleShareTarget {
  /** True when this platform can share this many FILES, not just text. */
  canShareFiles(files: readonly ShareableFile[]): boolean;
  /** Hand them to the share sheet. Rejects when the person cancels. */
  shareFiles(files: readonly ShareableFile[]): Promise<void>;
  /** Save them through links. Returns the number that reached the phone. */
  saveFiles(files: readonly ShareableFile[]): number;
}

function countSentence(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

/** Share the bundle and its frames, falling back to downloads, and say which. */
export async function shareFieldFiles(
  files: readonly ShareableFile[],
  target: BundleShareTarget,
): Promise<ShareResult> {
  if (files.length === 0) {
    return {
      outcome: 'failed' satisfies ShareOutcome,
      message: 'There is nothing to send yet — take a capture first.',
    };
  }

  if (target.canShareFiles(files)) {
    try {
      await target.shareFiles(files);
      return {
        outcome: 'shared',
        message:
          `Sent ${countSentence(files.length)} — the readings and the photographs — wherever you ` +
          'chose. Nothing was uploaded by this page.',
      };
    } catch (error) {
      // `AbortError` is the person closing the sheet, which is not a failure and
      // must not be reported as one. Anything else falls through to the save.
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          outcome: 'cancelled',
          message:
            'Nothing was sent. Everything is still here — tap Share again when you are ready.',
        };
      }
    }
  }

  const saved = target.saveFiles(files);
  if (saved === files.length) {
    return {
      outcome: 'saved',
      message:
        `This phone cannot hand the files straight to another app, so ${countSentence(saved)} were ` +
        'saved to its Files instead. Send them from there, all together.',
    };
  }
  if (saved > 0) {
    return {
      outcome: 'failed',
      message:
        `Only ${saved} of ${files.length} files were saved. The readings and the photographs have ` +
        'to travel together, so try Share again before you leave.',
    };
  }
  return {
    outcome: 'failed',
    message:
      'This browser would neither share nor save the files. Open the session in Safari and take ' +
      'the captures again.',
  };
}

/** Structurally what this module uses of `navigator`, so a test can pass a fake. */
export interface BundleShareNavigatorLike {
  share?: (data: { files: File[] }) => Promise<void>;
  canShare?: (data: { files: File[] }) => boolean;
}

/**
 * The real browser target.
 *
 * Every platform call is wrapped: `canShare` throws on some engines when handed
 * a `files` key it does not understand, and a `File` constructor is absent in
 * older WebViews. A throw anywhere here means "this route is unavailable", which
 * falls back rather than taking the screen down.
 */
export function browserBundleShareTarget(
  navigatorLike: BundleShareNavigatorLike | undefined,
  documentLike: Document | undefined,
): BundleShareTarget {
  const makeFile = (file: ShareableFile): File | undefined => {
    try {
      return new File([file.body], file.name, { type: file.mime });
    } catch {
      return undefined;
    }
  };

  const makeFiles = (files: readonly ShareableFile[]): File[] | undefined => {
    const out: File[] = [];
    for (const file of files) {
      const made = makeFile(file);
      if (made === undefined) return undefined;
      out.push(made);
    }
    return out;
  };

  return {
    canShareFiles(files) {
      const made = makeFiles(files);
      if (made === undefined) return false;
      if (navigatorLike?.share === undefined) return false;
      try {
        return navigatorLike.canShare?.({ files: made }) ?? false;
      } catch {
        return false;
      }
    },
    async shareFiles(files) {
      const made = makeFiles(files);
      const share = navigatorLike?.share;
      if (made === undefined || share === undefined) {
        throw new Error('no file share on this browser');
      }
      await share({ files: made });
    },
    saveFiles(files) {
      if (documentLike === undefined) return 0;
      let saved = 0;
      for (const file of files) {
        try {
          const blob =
            typeof file.body === 'string' ? new Blob([file.body], { type: file.mime }) : file.body;
          const url = URL.createObjectURL(blob);
          const link = documentLike.createElement('a');
          link.href = url;
          link.download = file.name;
          link.rel = 'noopener';
          documentLike.body.append(link);
          link.click();
          link.remove();
          // Revoked on a later turn of the event loop: revoking immediately
          // cancels the download on WebKit.
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          saved += 1;
        } catch {
          // One file that would not save does not stop the rest; the count is
          // what the message above is built from.
        }
      }
      return saved;
    },
  };
}
