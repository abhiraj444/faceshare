import type { ParticleSet } from "./types";

const MAGIC_0 = 0x50; // 'P'
const MAGIC_1 = 0x41; // 'A'
const MAGIC_2 = 0x52; // 'R'
const MAGIC_3 = 0x54; // 'T'
const FORMAT_VERSION = 1;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function compressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== "undefined") {
    try {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      void writer.write(bytes);
      void writer.close();
      const arrayBuffer = await new Response(cs.readable).arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } catch (e) {
      console.warn("Gzip compression failed, storing raw:", e);
    }
  }
  return bytes;
}

async function decompressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try {
        const ds = new DecompressionStream("gzip");
        const writer = ds.writable.getWriter();
        void writer.write(bytes);
        void writer.close();
        const arrayBuffer = await new Response(ds.readable).arrayBuffer();
        return new Uint8Array(arrayBuffer);
      } catch (e) {
        console.warn("Gzip decompression failed, trying raw:", e);
      }
    }
  }
  return bytes;
}

/**
 * Losslessly serializes a 3D ParticleSet into a compact, compressed Base64 string.
 * For 24,000 particles: raw binary ~576 KB, gzipped ~140-180 KB.
 */
export async function serializeParticleSet(set: ParticleSet): Promise<string> {
  const count = set.count;
  const hasSemantic = Boolean(set.semantic && set.semantic.length >= count);

  // Layout:
  // Offset 0: 4 bytes Magic ('PART')
  // Offset 4: 1 byte Version (1)
  // Offset 5: 1 byte Flags (bit 0 = hasSemantic)
  // Offset 6: 2 bytes Padding (for 4-byte alignment)
  // Offset 8: 4 bytes Count (uint32)
  // Offset 12: home (count * 3 * 4 bytes)
  // Offset 12 + 12*count: restZ (count * 4 bytes)
  // Offset 12 + 16*count: seed (count * 4 bytes)
  // Offset 12 + 20*count: tone (count bytes)
  // Offset 12 + 21*count: color (count * 3 bytes)
  // Offset 12 + 24*count: semantic (count bytes, if hasSemantic)
  const headerSize = 12;
  const homeBytes = count * 3 * 4;
  const restZBytes = count * 4;
  const seedBytes = count * 4;
  const toneBytes = count;
  const colorBytes = count * 3;
  const semanticBytes = hasSemantic ? count : 0;
  const totalBytes = headerSize + homeBytes + restZBytes + seedBytes + toneBytes + colorBytes + semanticBytes;

  const buffer = new ArrayBuffer(totalBytes);
  const u8 = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Magic & header
  u8[0] = MAGIC_0;
  u8[1] = MAGIC_1;
  u8[2] = MAGIC_2;
  u8[3] = MAGIC_3;
  u8[4] = FORMAT_VERSION;
  u8[5] = hasSemantic ? 1 : 0;
  u8[6] = 0;
  u8[7] = 0;
  view.setUint32(8, count, true);

  // Copy typed arrays safely
  let byteOffset = 12;

  // home (Float32Array)
  const homeU8 = new Uint8Array(set.home.buffer, set.home.byteOffset, homeBytes);
  u8.set(homeU8, byteOffset);
  byteOffset += homeBytes;

  // restZ (Float32Array)
  const restZU8 = new Uint8Array(set.restZ.buffer, set.restZ.byteOffset, restZBytes);
  u8.set(restZU8, byteOffset);
  byteOffset += restZBytes;

  // seed (Float32Array)
  const seedU8 = new Uint8Array(set.seed.buffer, set.seed.byteOffset, seedBytes);
  u8.set(seedU8, byteOffset);
  byteOffset += seedBytes;

  // tone (Uint8Array)
  const toneU8 = new Uint8Array(set.tone.buffer, set.tone.byteOffset, toneBytes);
  u8.set(toneU8, byteOffset);
  byteOffset += toneBytes;

  // color (Uint8Array)
  const colorU8 = new Uint8Array(set.color.buffer, set.color.byteOffset, colorBytes);
  u8.set(colorU8, byteOffset);
  byteOffset += colorBytes;

  // semantic (Uint8Array)
  if (hasSemantic && set.semantic) {
    const semU8 = new Uint8Array(set.semantic.buffer, set.semantic.byteOffset, semanticBytes);
    u8.set(semU8, byteOffset);
  }

  // Compress via Gzip stream
  const compressed = await compressBytes(u8);
  return uint8ArrayToBase64(compressed);
}

/**
 * Deserializes a Base64-encoded compressed 3D ParticleSet back into full TypedArrays.
 * Renders identically with 100% mathematical fidelity in milliseconds.
 */
export async function deserializeParticleSet(encoded: string): Promise<ParticleSet> {
  const compressedBytes = base64ToUint8Array(encoded);
  const rawBytes = await decompressBytes(compressedBytes);

  if (rawBytes.length < 12) {
    throw new Error("Invalid particle data: buffer too short");
  }

  if (
    rawBytes[0] !== MAGIC_0 ||
    rawBytes[1] !== MAGIC_1 ||
    rawBytes[2] !== MAGIC_2 ||
    rawBytes[3] !== MAGIC_3
  ) {
    throw new Error("Invalid particle data: magic mismatch");
  }

  const version = rawBytes[4];
  if (version !== 1) {
    throw new Error(`Unsupported particle data version: ${version}`);
  }

  const flags = rawBytes[5];
  const hasSemantic = (flags & 1) === 1;

  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  const count = view.getUint32(8, true);

  const homeBytes = count * 3 * 4;
  const restZBytes = count * 4;
  const seedBytes = count * 4;
  const toneBytes = count;
  const colorBytes = count * 3;
  const semanticBytes = hasSemantic ? count : 0;
  const expectedMinLength = 12 + homeBytes + restZBytes + seedBytes + toneBytes + colorBytes + semanticBytes;

  if (rawBytes.length < expectedMinLength) {
    throw new Error(`Invalid particle data length: expected at least ${expectedMinLength} bytes, got ${rawBytes.length}`);
  }

  let byteOffset = 12;

  // Clone into independent aligned buffers
  const homeBuf = rawBytes.buffer.slice(rawBytes.byteOffset + byteOffset, rawBytes.byteOffset + byteOffset + homeBytes);
  const home = new Float32Array(homeBuf);
  byteOffset += homeBytes;

  const restZBuf = rawBytes.buffer.slice(rawBytes.byteOffset + byteOffset, rawBytes.byteOffset + byteOffset + restZBytes);
  const restZ = new Float32Array(restZBuf);
  byteOffset += restZBytes;

  const seedBuf = rawBytes.buffer.slice(rawBytes.byteOffset + byteOffset, rawBytes.byteOffset + byteOffset + seedBytes);
  const seed = new Float32Array(seedBuf);
  byteOffset += seedBytes;

  const tone = new Uint8Array(rawBytes.subarray(byteOffset, byteOffset + toneBytes));
  byteOffset += toneBytes;

  const color = new Uint8Array(rawBytes.subarray(byteOffset, byteOffset + colorBytes));
  byteOffset += colorBytes;

  let semantic: Uint8Array | undefined = undefined;
  if (hasSemantic) {
    semantic = new Uint8Array(rawBytes.subarray(byteOffset, byteOffset + semanticBytes));
  }

  return {
    count,
    home,
    restZ,
    tone,
    seed,
    color,
    semantic,
  };
}
