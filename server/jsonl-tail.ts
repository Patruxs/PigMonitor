import { closeSync, openSync, readSync, type Stats } from "node:fs";

const NEWLINE = 0x0a;

export class JsonlTail {
  readonly file: string;
  private readonly ino: number;
  private offset = 0;
  private rest = Buffer.alloc(0);

  constructor(file: string, stat: Stats) {
    this.file = file;
    this.ino = stat.ino;
  }

  continues(stat: Stats): boolean {
    return stat.ino === this.ino && stat.size >= this.offset;
  }

  lines(stat: Stats): string[] {
    const out: string[] = [];
    if (stat.size > this.offset) {
      const chunk = Buffer.allocUnsafe(stat.size - this.offset);
      const fd = openSync(this.file, "r");
      try {
        readSync(fd, chunk, 0, chunk.length, this.offset);
      } finally {
        closeSync(fd);
      }
      this.offset = stat.size;
      const buf = this.rest.length > 0 ? Buffer.concat([this.rest, chunk]) : chunk;
      const end = buf.lastIndexOf(NEWLINE);
      this.rest = buf.subarray(end + 1);
      if (end >= 0) out.push(...buf.subarray(0, end).toString("utf8").split("\n"));
    }
    if (this.rest.length > 0 && isWholeJson(this.rest.toString("utf8"))) {
      out.push(this.rest.toString("utf8"));
      this.rest = Buffer.alloc(0);
    }
    return out;
  }
}

function isWholeJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
