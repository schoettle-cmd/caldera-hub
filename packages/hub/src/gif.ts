/**
 * A small animated GIF encoder (GIF89a, one global palette, LZW), no dependencies. Used for the live countdown in the
 * Armory gift email: the server draws the frames with flat rectangles each time the email is opened.
 */

export type RGB = [number, number, number];
export interface GifFrame { px: Uint8Array; /** hundredths of a second */ delay: number }

/** A paletted canvas: fill rectangles with a palette index. */
export class Canvas {
  readonly px: Uint8Array;
  constructor(readonly w: number, readonly h: number, bg = 0) { this.px = new Uint8Array(w * h).fill(bg); }
  rect(x: number, y: number, w: number, h: number, c: number) {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let j = y0; j < y1; j++) this.px.fill(c, j * this.w + x0, j * this.w + x1);
  }
  copy(): Uint8Array { return this.px.slice(); }
}

/** LZW-compress palette indices for one image block (min code size = bits of the palette, at least 2). */
function lzw(px: Uint8Array, minBits: number): number[] {
  const out: number[] = []; let cur = 0, curBits = 0;
  const clear = 1 << minBits, eoi = clear + 1;
  let size = minBits + 1, next = eoi + 1;
  const emit = (code: number) => { cur |= code << curBits; curBits += size; while (curBits >= 8) { out.push(cur & 0xff); cur >>>= 8; curBits -= 8; } };
  let dict = new Map<number, number>();
  emit(clear);
  let prefix = px[0]!;
  for (let i = 1; i < px.length; i++) {
    const k = px[i]!, key = (prefix << 8) | k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear); dict = new Map(); size = minBits + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

/** Encode frames into a GIF. loop: 0 = forever, n = play n+1 times, null = play once. */
export function encodeGif(w: number, h: number, palette: RGB[], frames: GifFrame[], loop: number | null = null): Buffer {
  let bits = 1; while ((1 << bits) < palette.length) bits++;
  const n = 1 << bits, B: number[] = [];
  const u16 = (v: number) => { B.push(v & 0xff, (v >> 8) & 0xff); };
  B.push(...Buffer.from("GIF89a")); u16(w); u16(h); B.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < n; i++) { const c = palette[i] || [0, 0, 0]; B.push(c[0], c[1], c[2]); }
  if (loop !== null) { B.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1); u16(loop); B.push(0); }
  const minBits = Math.max(2, bits);
  for (const f of frames) {
    B.push(0x21, 0xf9, 4, 0x04); u16(Math.max(0, Math.round(f.delay))); B.push(0, 0);   // graphic control: keep previous frame (disposal 1)
    B.push(0x2c); u16(0); u16(0); u16(w); u16(h); B.push(0);
    B.push(minBits);
    const data = lzw(f.px, minBits);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); B.push(chunk.length, ...chunk); }
    B.push(0);
  }
  B.push(0x3b);
  return Buffer.from(B);
}
