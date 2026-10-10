#!/usr/bin/env python3
"""Build Harness's pinned node-pty Node-API addon for Android ARM64."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.2.0-beta.15'
SOURCE_SHA = '5809f87b15122f335017b0b3020071df4c6205c7827186a2c5a9e0edc9ef59b2'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build(package, output):
    package, output = Path(package).resolve(), Path(output).resolve()
    if json.loads((package/'package.json').read_text())['version'] != VERSION:
        raise RuntimeError('Unsupported node-pty version')
    source = package/'src/unix/pty.cc'
    if digest(source) != SOURCE_SHA:
        raise RuntimeError('Unaudited node-pty source')
    include = Path(subprocess.check_output(['node', '-p',
        'require.resolve("node-addon-api/napi.h")'], cwd=package, text=True).strip()).parent
    sdk = Path(os.environ.get('ANDROID_HOME', ROOT/'.tools/android-sdk'))
    tools = sdk/'ndk/27.2.12479018/toolchains/llvm/prebuilt/linux-x86_64/bin'
    headers = ROOT/'.tools/node22/include/node'
    output.mkdir(parents=True, exist_ok=True)
    target = output/'pty.node'
    subprocess.run([str(tools/'aarch64-linux-android26-clang++'), '-std=c++17',
        '-O2', '-fPIC', '-shared', '-fexceptions', '-fstack-protector-strong',
        '-DNAPI_CPP_EXCEPTIONS', '-DNAPI_VERSION=8', '-I'+str(headers), '-I'+str(include),
        '-Wl,-z,max-page-size=16384', str(source), '-o', str(target)], check=True)
    elf = subprocess.check_output([str(tools/'llvm-readelf'), '-h', '-d', target], text=True)
    if 'AArch64' not in elf or 'libc.so.6' in elf:
        raise RuntimeError('Unexpected native target')
    (output/'manifest.json').write_text(json.dumps({'version':VERSION,
        'source_sha256':SOURCE_SHA, 'elf_sha256':digest(target), 'abi':'arm64-v8a',
        'ndk':'27.2.12479018', 'node_api':8, 'device_tested':False}, indent=2)+'\n')
    print(elf)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    build(args.package, args.output)
