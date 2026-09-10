import { inflateRawSync } from "node:zlib";

/** Extracts a single entry from an in-memory zip (PK\x03\x04) archive. */
export function extractZipEntry(bytes: Uint8Array, name: string): string {
  const centralSig = 0x02014b50;
  const localSig = 0x04034b50;
  const readU32 = (o: number) =>
    (bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)) >>> 0;
  const readU16 = (o: number) => bytes[o]! | (bytes[o + 1]! << 8);
  let entry: { compSize: number; localOffset: number } | null = null;
  for (let offset = 0; offset + 4 <= bytes.length; offset++) {
    if (readU32(offset) !== centralSig) continue;
    const nameLen = readU16(offset + 28);
    const compSize = readU32(offset + 20);
    const localOffset = readU32(offset + 42);
    const entryName = Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLen)).toString("utf8");
    if (entryName === name) {
      entry = { compSize, localOffset };
      break;
    }
  }
  if (!entry) throw new Error(`zip entry not found: ${name}`);
  if (readU32(entry.localOffset) !== localSig) throw new Error("bad local header");
  const nameLen = readU16(entry.localOffset + 26);
  const extraLen = readU16(entry.localOffset + 28);
  const dataOffset = entry.localOffset + 30 + nameLen + extraLen;
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compSize);
  return inflateRawSync(Buffer.from(compressed)).toString("utf8");
}
