#!/usr/bin/env python3
"""Cross-build the pinned Koffi FFI addon; verify the actual ELF architecture."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERSION = '3.1.1'
SOURCE_SHA = '7da0f340eaa0aad0a09e67fe054a65c8ee05bacdcf6d9d015bfed5289013fd99'
BASE_SHA = 'b0fde2f2e68158cc496392a63ae3b84d88eac798ac0713f8acd1f897d936791f'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build(package, output):
    package, output = Path(package).resolve(), Path(output).resolve()
    if json.loads((package/'package.json').read_text())['version'] != VERSION:
        raise RuntimeError('Unsupported Koffi version')
    if digest(package/'src/koffi/src/ffi.cc') != SOURCE_SHA:
        raise RuntimeError('Unaudited Koffi implementation')
    ndk = Path(os.environ.get('ANDROID_HOME', ROOT/'.tools/android-sdk'))/'ndk/27.2.12479018'
    env = dict(os.environ, MAKEFLAGS='-j4')
    # Koffi's internal command utility uses posix_spawn (Android 28). It is
    # not its exported FFI API. Keep API 26 loadable and fail closed if that
    # utility is ever called there; FFI itself retains the upstream code.
    base = package/'lib/native/base/base.cc'
    content = base.read_text()
    old = '    // DeepCode Android API 26: optional posix_spawn utility.\n#if defined(__ANDROID__) && __ANDROID_API__ < 28\n    if (!posix_spawn) { LogError("posix_spawn requires Android API 28"); return false; }\n#endif\n'
    content = content.replace(old, '')
    anchor = '{\n    BlockAllocator temp_alloc;\n\n    // Create read pipes'
    end = '    return true;\n}\n\n#endif\n\nbool ExecuteCommandLine'
    stat = 'static StatResult StatAt(int fd, bool fd_is_directory, const char *filename, unsigned int flags, FileInfo *out_info)\n{\n#if defined(__linux__)'
    marker = '// DeepCode Android API 26: utility is not exported by Koffi.'
    if marker not in content:
        if digest(base) != BASE_SHA:
            raise RuntimeError('Unaudited Koffi platform utility')
        if content.count(anchor) != 1 or content.count(end) != 1 or content.count(stat) != 1:
            raise RuntimeError('Unsupported Koffi process utility')
        content = content.replace(anchor, '{\n    '+marker+'\n'
            '#if defined(__ANDROID__) && __ANDROID_API__ < 28\n'
            '    LogError("posix_spawn requires Android API 28"); return false;\n'
            '#else\n    BlockAllocator temp_alloc;\n\n    // Create read pipes')
        content = content.replace(end, end.replace('    return true;\n}', '    return true;\n#endif\n}'))
        content = content.replace(stat, stat+' && !defined(__ANDROID__)')
        base.write_text(content)
    args = ['node', 'cnoke.cjs', '-P', '.', '-D', 'src/koffi',
        '-t', 'android_ndk_arm64', '--runtime', '24.18.0', '--release',
        '-d', 'CMAKE_TOOLCHAIN_FILE='+str(ndk/'build/cmake/android.toolchain.cmake'),
        '-d', 'ANDROID_ABI=arm64-v8a', '-d', 'ANDROID_PLATFORM=android-26',
        '-d', 'ANDROID_ALLOW_UNDEFINED_SYMBOLS=TRUE',
        '-d', 'CMAKE_CXX_FLAGS=',
        '-d', 'CMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384']
    subprocess.run(args[:2]+['configure']+args[2:], cwd=package, env=env, check=True)
    subprocess.run(args, cwd=package, env=env, check=True)
    built = package/'build/koffi/android_ndk_arm64/koffi.node'
    elf = subprocess.check_output([str(ndk/'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf'),
        '-h', '-d', built], text=True)
    if 'AArch64' not in elf or 'libc.so.6' in elf:
        raise RuntimeError('Koffi was compiled for the host instead of Android')
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(built, output/'koffi.node')
    (output/'manifest.json').write_text(json.dumps({'version':VERSION,
        'source_sha256':SOURCE_SHA, 'elf_sha256':digest(built), 'abi':'arm64-v8a',
        'ndk':'27.2.12479018', 'device_tested':False}, indent=2)+'\n')
    print(elf)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    build(args.package, args.output)
