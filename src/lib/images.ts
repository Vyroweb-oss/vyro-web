// Image Pro helpers (Mission 2, M2-07 = owner spec §13).
//
// Pure and local: nothing here uploads anything. Width presets are stored
// as the TipTap Image node's native `width` attr (a string like '50%');
// the page CSS maps each preset to a real width while height:auto (also in
// CSS) preserves the aspect ratio. Captions reuse the Image node's native
// `title` attr — no new node type is invented, so a caption round-trips
// through save/load exactly like alt text does. A visible caption line
// under the image is NOT rendered: that would need a new node type, which
// the spec forbids inventing here; the caption lives in the dialog and as
// the image's title (tooltip). Likewise there is no DOM onerror hook: the
// stock Image node has no node view, so a broken src shows the browser's
// broken-image icon; FileReader failures still surface as a toast.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/** Width presets offered in the image dialog, as % of page width. '' = original size (attr cleared). */
export const IMAGE_WIDTH_PRESETS: { value: string; label: string }[] = [
  { value: '', label: 'original' },
  { value: '25%', label: '25%' },
  { value: '50%', label: '50%' },
  { value: '75%', label: '75%' },
  { value: '100%', label: '100%' },
]

export type ImageFileError = 'imageInvalid' | 'imageTooLarge' | null

/** Validate a picked file before any read: image MIME + the 2 MB cap. */
export function validateImageFile(file: { type?: string; size?: number } | null | undefined): ImageFileError {
  if (!file || !file.type?.startsWith('image/')) return 'imageInvalid'
  if ((file.size ?? 0) > MAX_IMAGE_BYTES) return 'imageTooLarge'
  return null
}

/** Whole kilobytes for the insert-preview dialog (never 0 for a real file). */
export function imageSizeKb(size: number): number {
  return Math.max(1, Math.round(size / 1024))
}
