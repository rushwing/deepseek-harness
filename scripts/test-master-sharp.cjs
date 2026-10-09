// Exercise Sharp's shipped WASM fallback with an unsupported native platform.
// This is a host compatibility test, not an Android device execution test.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const engine = path.resolve(process.argv[2]);
const fallback = path.resolve(__dirname, 'runtime-sharp-wasm/node_modules');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith('@img/sharp-wasm32') || name === '@emnapi/runtime' || name === 'tslib') {
    return originalResolve.call(this, name, { ...parent, paths: [fallback] }, ...rest);
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Object.defineProperty(process, 'platform', { value: 'android' });
const sharp = require(engine);
(async () => {
  const image = await sharp({ create: { width: 64, height: 32, channels: 3,
    background: '#cc4400' } }).png().toBuffer();
  const resized = await sharp(image).resize(16, 8).jpeg().toBuffer();
  const info = await sharp(resized).metadata();
  assert.equal(info.width, 16);
  assert.equal(info.height, 8);
  assert.equal(info.format, 'jpeg');
  assert.equal(sharp.versions.vips, '8.18.7');
  console.log('PASS: official Sharp WASM image encoding, resizing and metadata');
})().catch(error => { console.error(error); process.exitCode = 1; });
