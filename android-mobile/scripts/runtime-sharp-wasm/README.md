# Android Sharp fallback

The master engine uses Sharp 0.35.5. Its official loader selects
`@img/sharp-wasm32` when no native addon supports Android. Install these exact
software dependencies with `npm ci --force --ignore-scripts`; `--force` permits
the package's WASM architecture on the build host. No native ELF is taken from
the host. `test-master-sharp.cjs <deployed-sharp-package>` exercises the actual
official fallback, image encoding, resizing and metadata on the host.

The unmodified npm package retains its LICENSE, README, component versions,
JavaScript loader and separate WASM binary. The README contains the upstream
third-party license matrix. Libvips, glib, libexif and libheif are used under
LGPL-3.0-or-later; distribute the GNU license texts with the APK and snapshot.
Users may replace the separate WASM module and its loader when rebuilding the
runtime; the shell does not impose a signature check on that module. Sources
and the WASM build recipes are maintained by
[sharp](https://github.com/lovell/sharp) and
[sharp-libvips](https://github.com/lovell/sharp-libvips). Preserve corresponding
source and component notices when distributing a release; the host regression
test does not establish Android device execution or license compliance alone.
