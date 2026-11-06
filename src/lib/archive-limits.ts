const MAX_ARCHIVE_ENTRIES = 2_500;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_EXPANSION_RATIO = 250;

/** Load an Office/OpenDocument ZIP only after bounding its declared expansion. */
export async function loadOfficeArchive(bytes: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  const entries = Object.entries(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("This document contains too many archive entries to process safely.");
  let total = 0;
  for (const [path, entry] of entries) {
    if (path.startsWith("/") || path.split(/[\\/]/).some((part) => part === "..")) {
      throw new Error("This document contains an unsafe archive path.");
    }
    if (entry.dir) continue;
    const sizes = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data;
    const expanded = sizes?.uncompressedSize;
    const compressed = sizes?.compressedSize;
    if (!Number.isSafeInteger(expanded) || expanded! < 0 || !Number.isSafeInteger(compressed) || compressed! < 0) {
      throw new Error("This document has invalid archive size metadata.");
    }
    if (expanded! > MAX_ARCHIVE_ENTRY_BYTES || (compressed! === 0 ? expanded! > 0 : expanded! / compressed! > MAX_ARCHIVE_EXPANSION_RATIO)) {
      throw new Error("This document expands beyond the safe extraction limit.");
    }
    total += expanded!;
    if (total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) throw new Error("This document expands beyond the safe extraction limit.");
  }
  return zip;
}
