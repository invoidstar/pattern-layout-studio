function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, false);
}

function createPhysChunk(dpi: number): Uint8Array {
  const ppm = Math.max(1, Math.round(dpi / 0.0254));
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  writeUint32(view, 0, 9);

  const type = new Uint8Array([0x70, 0x48, 0x59, 0x73]); // pHYs
  chunk.set(type, 4);
  writeUint32(view, 8, ppm);
  writeUint32(view, 12, ppm);
  chunk[16] = 1; // pixels per metre

  const crcInput = new Uint8Array(4 + 9);
  crcInput.set(type, 0);
  crcInput.set(chunk.subarray(8, 17), 4);
  writeUint32(view, 17, crc32(crcInput));
  return chunk;
}

export async function canvasToPngWithDpi(canvas: HTMLCanvasElement, dpi: number): Promise<Blob> {
  const source = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });

  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.length < 33 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
    throw new Error('Unexpected PNG structure');
  }

  // Canvas-generated PNGs place IHDR first. Insert pHYs immediately after it.
  const insertAt = 33;
  const phys = createPhysChunk(dpi);
  const output = new Uint8Array(bytes.length + phys.length);
  output.set(bytes.subarray(0, insertAt), 0);
  output.set(phys, insertAt);
  output.set(bytes.subarray(insertAt), insertAt + phys.length);
  return new Blob([output], { type: 'image/png' });
}
