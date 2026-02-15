const fs = require('fs');
const zlib = require('zlib');

function detectCompressed(filePath) {
  if (filePath.endsWith('.xml.gz') || filePath.endsWith('.gz')) return true;
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(2);
  fs.readSync(fd, buf, 0, 2, 0);
  fs.closeSync(fd);
  return buf[0] === 0x1f && buf[1] === 0x8b;
}

function createInputStream(filePath) {
  const compressed = detectCompressed(filePath);
  const source = fs.createReadStream(filePath);
  return compressed ? source.pipe(zlib.createGunzip()) : source;
}

function createOutputStream(filePath, compress) {
  const sink = fs.createWriteStream(filePath);
  if (!compress) return sink;
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
  gzip.pipe(sink);
  return gzip;
}

module.exports = {
  detectCompressed,
  createInputStream,
  createOutputStream
};
