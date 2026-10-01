// Builds the Chrome Web Store upload: dist/youtube-media-counter-<version>.zip.
// Only the extension's own files go in, and the manifest loses its "key" (the store refuses it and
// assigns its own ID). No dependencies: the zip is written by hand with node:zlib.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INCLUDE = ["_locales", "background", "content", "icons", "options", "pip", "popup", "shared"];
const MAX_DESCRIPTION_LENGTH = 132;

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// A plain zip (deflate, no zip64): local headers with the data, then the central directory.
function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// The store rejects descriptions over 132 characters, translated ones included.
function checkDescriptions() {
  const problems = [];
  for (const locale of readdirSync(join(ROOT, "_locales"))) {
    const messages = JSON.parse(readFileSync(join(ROOT, "_locales", locale, "messages.json"), "utf8"));
    const length = [...messages.appDescription.message].length;
    if (length > MAX_DESCRIPTION_LENGTH) problems.push(`_locales/${locale}: description is ${length} characters`);
  }
  return problems;
}

const problems = checkDescriptions();
if (problems.length > 0) {
  console.error(`Not packed, max description length is ${MAX_DESCRIPTION_LENGTH}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
delete manifest.key;

const entries = [{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") }];
for (const dir of INCLUDE) {
  for (const path of listFiles(join(ROOT, dir)).sort()) {
    entries.push({ name: relative(ROOT, path).split(sep).join("/"), data: readFileSync(path) });
  }
}

const outDir = join(ROOT, "dist");
const outFile = join(outDir, `youtube-media-counter-${manifest.version}.zip`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, createZip(entries));
console.log(`Packed ${entries.length} files into ${relative(ROOT, outFile)}`);
