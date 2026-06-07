import fs from 'node:fs';
import {
  asyncBufferFromFile,
  parquetReadObjects,
  parquetMetadataAsync,
} from 'hyparquet';

export async function readParquet(filePath, columns = undefined) {
  const file = await asyncBufferFromFile(filePath);
  return parquetReadObjects({ file, columns });
}

export async function readParquetTail(filePath, nRows = 1, columns = undefined) {
  const file = await asyncBufferFromFile(filePath);
  const meta = await parquetMetadataAsync(file);
  const total = Number(meta.num_rows);
  if (total === 0) return [];
  const rowStart = Math.max(0, total - nRows);
  return parquetReadObjects({ file, columns, rowStart, rowEnd: total });
}

export function listParquetFilesSorted(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.parquet'))
    .sort();
}
