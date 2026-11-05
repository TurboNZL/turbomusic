import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

/**
 * A tiny tar (ustar) writer and reader, enough for the data-folder export: regular files with short names.
 * Written here so the Pi needs no extra packages, and any archive tool can open the result.
 */
const BLOCK = 512;

export interface TarEntry {
  name: string;
  size: number;
  /** read from disk when streaming; otherwise `data` */
  path?: string;
  data?: Buffer;
}

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

export function tarHeader(name: string, size: number, mtime = Math.floor(Date.now() / 1000)): Buffer {
  // ustar keeps 100 bytes of name and 155 of "prefix" (the folders): a long path is split at a '/'
  let nameBytes = Buffer.from(name), prefixBytes = Buffer.alloc(0);
  if (nameBytes.length > 100) {
    const cut = [...name.matchAll(/\//g)].map((m) => m.index!).reverse().find((i) => Buffer.byteLength(name.slice(i + 1)) <= 100 && Buffer.byteLength(name.slice(0, i)) <= 155);
    if (cut === undefined) throw new Error(`tar name too long: ${name}`);
    prefixBytes = Buffer.from(name.slice(0, cut)); nameBytes = Buffer.from(name.slice(cut + 1));
  }
  if (size > 0o77777777777) throw new Error('tar entry over 8 GiB');
  const h = Buffer.alloc(BLOCK);
  nameBytes.copy(h, 0); prefixBytes.copy(h, 345);
  h.write(octal(0o644, 8), 100); h.write(octal(0, 8), 108); h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124); h.write(octal(mtime, 12), 136);
  h.write('        ', 148); // checksum counts these as spaces
  h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

const pad = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

/** Total bytes the archive will have, so a download can show progress. */
export function tarLength(entries: TarEntry[]): number {
  return entries.reduce((n, e) => n + BLOCK + e.size + pad(e.size), 0) + 2 * BLOCK;
}

export async function* tarChunks(entries: TarEntry[]): AsyncGenerator<Buffer> {
  for (const e of entries) {
    yield tarHeader(e.name, e.size);
    if (e.data) yield e.data;
    else if (e.path) {
      let sent = 0;
      for await (const chunk of createReadStream(e.path) as AsyncIterable<Buffer>) { sent += chunk.length; yield chunk; }
      if (sent !== e.size) throw new Error(`${e.name} changed size while it was being archived`);
    }
    if (pad(e.size)) yield Buffer.alloc(pad(e.size));
  }
  yield Buffer.alloc(2 * BLOCK);
}

export const tarStream = (entries: TarEntry[]) => Readable.toWeb(Readable.from(tarChunks(entries))) as unknown as ReadableStream;

/** Pulls exact byte counts out of a chunked stream. */
export class ByteReader {
  private it: AsyncIterator<Uint8Array>;
  private buf: Buffer = Buffer.alloc(0);
  private done = false;
  constructor(source: AsyncIterable<Uint8Array>) { this.it = source[Symbol.asyncIterator](); }

  private async fill(): Promise<boolean> {
    if (this.done) return false;
    const r = await this.it.next();
    if (r.done) { this.done = true; return false; }
    this.buf = this.buf.length ? Buffer.concat([this.buf, r.value]) : Buffer.from(r.value);
    return true;
  }
  /** exactly n bytes; null when the stream ended before the first byte; throws when it ended inside */
  async readExact(n: number): Promise<Buffer | null> {
    while (this.buf.length < n) {
      if (!(await this.fill())) {
        if (!this.buf.length) return null;
        throw new Error('The archive is cut short');
      }
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
  /** the next n bytes as chunks, without holding them all */
  async *chunks(n: number): AsyncGenerator<Buffer> {
    let left = n;
    while (left > 0) {
      if (!this.buf.length && !(await this.fill())) throw new Error('The archive is cut short');
      const take = this.buf.subarray(0, Math.min(left, this.buf.length));
      this.buf = this.buf.subarray(take.length);
      left -= take.length;
      yield take;
    }
  }
  async skip(n: number) { for await (const _ of this.chunks(n)) void _; }
}

export interface TarFile { name: string; size: number; body: AsyncGenerator<Buffer> }

/**
 * Entries in order. The caller must consume (or skip) `body` before asking for the next one; the padding after a
 * body is skipped here.
 */
export async function* readTar(source: AsyncIterable<Uint8Array>): AsyncGenerator<TarFile> {
  const r = new ByteReader(source);
  for (;;) {
    const h = await r.readExact(BLOCK);
    if (!h || h.every((b) => b === 0)) return;
    const end = h.indexOf(0, 0); const nameEnd = end === -1 || end > 100 ? 100 : end;
    let name = h.toString('utf8', 0, nameEnd);
    const prefixEnd = h.indexOf(0, 345); const prefix = h.toString('utf8', 345, prefixEnd === -1 || prefixEnd > 500 ? 500 : prefixEnd);
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(h.toString('ascii', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    if (!Number.isFinite(size) || size < 0) throw new Error('The archive is damaged');
    if (type !== '0') { await r.skip(size + pad(size)); continue; } // directories, links, pax headers: not needed
    const body = r.chunks(size);
    yield { name, size, body };
    for await (const _ of body) void _; // whatever the caller left unread
    await r.skip(pad(size));
  }
}
