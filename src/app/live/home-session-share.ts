/**
 * Getting the recording off the phone, by the person's own action only.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO UPLOAD, EVER
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTS.md § "Captures from the phone": *"A capture bundle travels only by the
 * human's own action, to their own account."* So this module has no `fetch`, no
 * `XMLHttpRequest` and no URL of its own. There are exactly two ways out:
 *
 *   Web Share, with the JSON as a FILE. iOS shows the system share sheet and
 *   the person picks Mail, Messages, AirDrop or Files. The page never learns
 *   which, and the bytes go wherever they chose.
 *   A download link, when the browser has no file share. A blob URL and a
 *   synthetic click; the file lands in the phone's own Files app.
 *
 * `navigator.share` must be called from inside a user gesture, so it is invoked
 * straight from the Share button's handler with no `await` before it. An await
 * on anything else first loses the gesture and iOS rejects the call.
 *
 * ── SHARING TEXT IS NOT A FALLBACK ─────────────────────────────────────────
 * `navigator.share({ text })` exists everywhere `share` does, and pasting a
 * recording into a message body would truncate it without saying so. So a
 * platform that cannot share FILES gets the download link instead, and the
 * screen says which of the two happened.
 */

/** The file being handed over. */
export interface SharedRecordingFile {
  readonly name: string;
  readonly json: string;
}

export type ShareOutcome =
  /** The platform's share sheet took it. */
  | 'shared'
  /** Saved to the phone's own files through a download link. */
  | 'saved'
  /** The person closed the share sheet. The file is still here. */
  | 'cancelled'
  /** Neither route worked. */
  | 'failed';

/**
 * What the two routes need from the platform.
 *
 * Injected as functions rather than reached for through `window`, so the
 * decision between them is testable with no DOM and the e2e can stub the share
 * sheet without touching this module.
 */
export interface ShareTarget {
  /** True when this platform can share a FILE, not just text. */
  canShareFile(file: SharedRecordingFile): boolean;
  /** Hand it to the share sheet. Rejects when the person cancels. */
  shareFile(file: SharedRecordingFile): Promise<void>;
  /** Save it through a link. Returns false when even that is unavailable. */
  saveFile(file: SharedRecordingFile): boolean;
}

export interface ShareResult {
  readonly outcome: ShareOutcome;
  /** One sentence for the screen, in the person's own terms. */
  readonly message: string;
}

/** Share the file, falling back to a download, and say which happened. */
export async function shareRecording(
  file: SharedRecordingFile,
  target: ShareTarget,
): Promise<ShareResult> {
  if (target.canShareFile(file)) {
    try {
      await target.shareFile(file);
      return {
        outcome: 'shared',
        message: `Sent ${file.name} wherever you chose. Nothing was uploaded by this page.`,
      };
    } catch (error) {
      // `AbortError` is the person closing the sheet, which is not a failure and
      // must not be reported as one. Anything else falls through to the save.
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          outcome: 'cancelled',
          message: 'Nothing was sent. The file is still here — tap Share again when you are ready.',
        };
      }
    }
  }

  return target.saveFile(file)
    ? {
        outcome: 'saved',
        message:
          `This phone cannot hand the file straight to another app, so ${file.name} was saved ` +
          'to its Files instead. Send it from there.',
      }
    : {
        outcome: 'failed',
        message:
          'This browser would neither share nor save the file. Copy the text below by hand, or ' +
          'open the session in Safari.',
      };
}

/** Structurally what this module uses of `navigator`, so a test can pass a fake. */
export interface ShareNavigatorLike {
  share?: (data: { files: File[] }) => Promise<void>;
  canShare?: (data: { files: File[] }) => boolean;
}

/** MIME type the file is offered as. */
export const RECORDING_MIME = 'application/json';

/**
 * The real browser target.
 *
 * Every platform call is wrapped: `canShare` throws on some engines when handed
 * a `files` key it does not understand, and a `File` constructor is absent in
 * older WebViews. A throw anywhere here means "this route is unavailable", which
 * falls back rather than taking the screen down.
 */
export function browserShareTarget(
  navigatorLike: ShareNavigatorLike | undefined,
  documentLike: Document | undefined,
): ShareTarget {
  const makeFile = (file: SharedRecordingFile): File | undefined => {
    try {
      return new File([file.json], file.name, { type: RECORDING_MIME });
    } catch {
      return undefined;
    }
  };

  return {
    canShareFile(file) {
      const asFile = makeFile(file);
      if (asFile === undefined) return false;
      if (navigatorLike?.share === undefined) return false;
      try {
        return navigatorLike.canShare?.({ files: [asFile] }) ?? false;
      } catch {
        return false;
      }
    },
    async shareFile(file) {
      const asFile = makeFile(file);
      const share = navigatorLike?.share;
      if (asFile === undefined || share === undefined) throw new Error('no file share on this browser');
      await share({ files: [asFile] });
    },
    saveFile(file) {
      if (documentLike === undefined) return false;
      try {
        const blob = new Blob([file.json], { type: RECORDING_MIME });
        const url = URL.createObjectURL(blob);
        const link = documentLike.createElement('a');
        link.href = url;
        link.download = file.name;
        link.rel = 'noopener';
        documentLike.body.append(link);
        link.click();
        link.remove();
        // Revoked on the next turn of the event loop: revoking immediately
        // cancels the download on WebKit.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return true;
      } catch {
        return false;
      }
    },
  };
}
