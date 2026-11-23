// Structural validation of an uploaded .xlsx (a ZIP container) *before* it is parsed.
// Protects against non-xlsx content, macro-enabled workbooks and decompression bombs.
export interface GuardLimits {
  maxBytes: number;
  maxEntries: number;
  maxUncompressedBytes: number;
  maxRatio: number;
}

export const DEFAULT_LIMITS: GuardLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxEntries: 2000,
  maxUncompressedBytes: 150 * 1024 * 1024,
  maxRatio: 200,
};

export class UploadRejected extends Error {}

export function validateXlsxContainer(buf: Buffer, limits: GuardLimits = DEFAULT_LIMITS) {
  if (buf.length === 0) throw new UploadRejected("The file is empty.");
  if (buf.length > limits.maxBytes) throw new UploadRejected(`The file is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`);
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new UploadRejected("The file is not a valid .xlsx workbook.");
  // Locate End Of Central Directory record (within the last 64 KB + 22 bytes).
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new UploadRejected("The workbook is corrupted (no ZIP directory found).");
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) throw new UploadRejected("ZIP64 workbooks are not supported.");
  if (entries > limits.maxEntries) throw new UploadRejected("The workbook contains too many internal parts.");
  if (cdOffset + cdSize > buf.length) throw new UploadRejected("The workbook is corrupted.");
  let p = cdOffset;
  let total = 0;
  const names: string[] = [];
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new UploadRejected("The workbook is corrupted.");
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    names.push(name);
    total += uncompressed;
    if (total > limits.maxUncompressedBytes) throw new UploadRejected("The workbook expands to an unsafe size.");
    if (compressed > 0 && uncompressed / compressed > limits.maxRatio && uncompressed > 1_000_000) {
      throw new UploadRejected("The workbook has a suspicious compression ratio.");
    }
    if (name.includes("..") || name.startsWith("/")) throw new UploadRejected("The workbook contains invalid paths.");
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!names.includes("[Content_Types].xml") || !names.some((n) => n.startsWith("xl/workbook"))) {
    throw new UploadRejected("The file is not a valid .xlsx workbook.");
  }
  if (names.some((n) => /vbaProject\.bin$/i.test(n))) {
    throw new UploadRejected("Macro-enabled workbooks are not accepted. Save the file as a normal .xlsx workbook.");
  }
  if (names.some((n) => /^xl\/externalLinks\//i.test(n))) {
    // Allowed, but external links are never followed by the importer.
  }
  return { entries, uncompressedBytes: total };
}
