import fs from 'node:fs';

/** Last `nLines` non-empty lines of a file, read backwards in 4k chunks. */
export function tailLines(file, nLines) {
  const st = fs.statSync(file);
  const chunkSize = 4096;
  const buffers = [];
  let pos = st.size;
  let lines = 0;
  const fd = fs.openSync(file, 'r');
  try {
    while (pos > 0 && lines <= nLines) {
      const read = Math.min(chunkSize, pos);
      pos -= read;
      const buf = Buffer.alloc(read);
      fs.readSync(fd, buf, 0, read, pos);
      buffers.unshift(buf);
      for (const b of buf) if (b === 0x0a) lines++;
    }
  } finally {
    fs.closeSync(fd);
  }
  return Buffer.concat(buffers).toString('utf8').split('\n').filter(Boolean).slice(-nLines);
}
