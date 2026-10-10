#!/usr/bin/env python3
"""Cross-compile the fixed upstream Node-API flock implementation for Android.

Uses the configured NDK and Node headers; does not access devices or install
anything. Inputs and the resulting ELF fingerprint are recorded locally.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.1.2'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    entry = source / 'native/system/packages/entry'
    if json.loads((entry / 'package.json').read_text())['version'] != VERSION:
        raise RuntimeError('Unsupported upstream native system package')
    sdk = Path(os.environ.get('ANDROID_HOME', ROOT / '.tools/android-sdk'))
    ndk = sdk / 'ndk/27.2.12479018'
    tools = ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin'
    headers = ROOT / '.tools/node22/include/node'
    implementation = entry / 'src/flock.c'
    if sha(implementation) != 'c1aa773c7a62b03ce3973156b928f41773fef9407afd79d71b2f625b5616421f':
        raise RuntimeError('Unaudited upstream flock source')
    output.mkdir(parents=True, exist_ok=True)
    target = output / 'system.node'
    subprocess.run([str(tools / 'aarch64-linux-android26-clang'), '-std=c11',
                    '-O2', '-fPIC', '-shared', '-D_GNU_SOURCE', '-DNAPI_VERSION=8',
                    '-I' + str(headers), '-Wl,-z,max-page-size=16384',
                    str(implementation), '-o', str(target)], check=True)
    elf = subprocess.check_output([str(tools / 'llvm-readelf'), '-h', '-d', str(target)], text=True)
    if 'AArch64' not in elf or 'libc.so.6' in elf or 'GLIBC_' in elf:
        raise RuntimeError('Native flock payload is not an Android ARM64 ELF')
    wrapper = (entry / 'lib/flock.js').read_text()
    anchor = '    const { platform, arch } = process;'
    if wrapper.count(anchor) != 1:
        raise RuntimeError('Unsupported upstream flock binding loader')
    wrapper = wrapper.replace(anchor, anchor + '''
    if (platform === 'android' && arch === 'arm64') {
        const require = createRequire(import.meta.url);
        binding = require('../android-arm64/system.node');
        return binding;
    }
''', 1)
    (output / 'flock.js').write_text(wrapper)
    receipt = {'schema': 1, 'abi': 'arm64-v8a', 'api': 26,
               'upstreamVersion': VERSION, 'sourceSha256': sha(implementation),
               'headerSha256': sha(headers / 'node_api.h'),
               'ndkVersion': '27.2.12479018', 'elfSha256': sha(target),
               'wrapperSha256': sha(output / 'flock.js')}
    (output / 'manifest.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.output), indent=2))
