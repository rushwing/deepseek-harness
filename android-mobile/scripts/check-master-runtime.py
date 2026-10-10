#!/usr/bin/env python3
"""Verify the master snapshot independently of the legacy engine manifest."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import struct
import tarfile

VERSION = '0.2.1-alpha.2'
COMMIT = 'd743267388641bc76f17c45ce8b4c231aed1d32c'
ENGINE = 'usr/lib/node_modules/@deepseek-ai/dsh'


def check(snapshot, receipt, assets):
    receipt = json.loads(Path(receipt).read_text())
    if receipt['engine'] != VERSION or receipt['commit'] != COMMIT:
        raise RuntimeError('Wrong master source receipt')
    members, metadata, hashes, elf = {}, {}, {}, {}
    termux_search = False
    with tarfile.open(snapshot, 'r|xz') as archive:
        for item in archive:
            name = item.name.rstrip('/')
            if name in members and not name.startswith('usr/share/LICENSES/'):
                raise RuntimeError('Duplicate snapshot member: '+name)
            members[name] = item
            if not item.isfile(): continue
            stream = archive.extractfile(item)
            if name == 'usr/bin/rg':
                header = stream.read(64)
                termux_search = (header[:6] == b'\x7fELF\x02\x01' and
                    struct.unpack_from('<H',header,18)[0] == 183 and bool(item.mode & 0o100))
            elif name.startswith(ENGINE+'/') and name.endswith('/package.json'):
                metadata[name] = json.loads(stream.read())
            elif name.startswith(ENGINE+'/'):
                data = stream.read()
                hashes[name] = hashlib.sha256(data).hexdigest()
                if data[:4] == b'\x7fELF':
                    if data[4:6] != b'\x02\x01' or struct.unpack_from('<H',data,18)[0] != 183:
                        raise RuntimeError('Host ELF in Android engine: '+name)
                    if b'libc.so.6\0' in data or b'ld-linux-' in data:
                        raise RuntimeError('Non-Bionic ELF in Android engine: '+name)
                    offset = struct.unpack_from('<Q', data, 32)[0]
                    size, count = struct.unpack_from('<HH', data, 54)
                    aligns = [struct.unpack_from('<Q',data,offset+i*size+48)[0]
                              for i in range(count) if struct.unpack_from('<I',data,offset+i*size)[0] == 1]
                    if not aligns or min(aligns) < 16384:
                        raise RuntimeError('Addon lacks 16 KiB alignment: '+name)
                    elf[name] = hashes[name]
    if not termux_search:
        raise RuntimeError('Missing executable ARM64 Termux search binary')
    def resolve(name):
        parts = PurePosixPath(name).parts
        for count in range(1, len(parts)+1):
            prefix = '/'.join(parts[:count])
            item = members.get(prefix)
            if item and item.issym():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(prefix), item.linkname,
                    *parts[count:]))
                if not target.startswith(('usr/','home/')):
                    raise RuntimeError('Engine alias escaped snapshot: '+prefix)
                return resolve(target)
        return name
    root = metadata[ENGINE+'/package.json']
    if root['version'] != VERSION: raise RuntimeError('Wrong packaged CLI')
    for name, item in members.items():
        if name.startswith(ENGINE+'/') and item.issym():
            resolve(name)  # also rejects build-source and absolute external links
    for name, version in receipt['packages'].items():
        target = resolve(ENGINE+'/node_modules/'+name+'/package.json')
        if metadata.get(target, {}).get('version') != version:
            raise RuntimeError('Missing/wrong runtime package: '+name)
    # Validate required workspace services across the actual packed tree.
    for name, package in metadata.items():
        for field in ('dependencies','peerDependencies'):
            for dep in package.get(field, {}):
                if not dep.startswith('@deepseek-ai/'): continue
                if package.get('peerDependenciesMeta',{}).get(dep,{}).get('optional'): continue
                if dep not in receipt['packages'] and dep != root['name']:
                    raise RuntimeError(f'Missing runtime workspace dependency {dep} required by {package["name"]}')
    manifest = json.loads((Path(assets)/'master-runtime-patches.json').read_text())
    if manifest['patches'] != receipt['patches']: raise RuntimeError('Patch manifest differs from snapshot receipt')
    for row in manifest['patches']:
        target = resolve(ENGINE+'/node_modules/'+row['name']+'/'+row['relative'])
        asset = Path(assets)/'patched'/(row['patch']+'.js')
        if hashes.get(target) != row['sha256'] or hashlib.sha256(asset.read_bytes()).hexdigest() != row['sha256']:
            raise RuntimeError('Packaged patch differs: '+row['name'])
    for name, native in [('android-flock','system.node'),('android-pty','pty.node'),('android-koffi','koffi.node')]:
        native_receipt = receipt['native'][name]
        sha = native_receipt['elfSha256'] if name == 'android-flock' else native_receipt['elf_sha256']
        if sha not in elf.values(): raise RuntimeError('Missing built Android addon: '+native)
    if len(elf) != 3: raise RuntimeError(f'Unexpected native addon count: {len(elf)}')
    flock = resolve(ENGINE+'/node_modules/@deepseek-ai/node-addon-system/lib/flock.js')
    if hashes.get(flock) != receipt['native']['android-flock']['wrapperSha256']:
        raise RuntimeError('Android file-lock loader differs from native receipt')
    binding = resolve(posixpath.normpath(posixpath.join(posixpath.dirname(flock), '../android-arm64/system.node')))
    if binding not in elf: raise RuntimeError('Android file-lock loader target is missing')
    for entry in ('lib/bin.js','node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'):
        if resolve(ENGINE+'/'+entry) not in hashes: raise RuntimeError('Missing executable Web deployment: '+entry)
    print(f'PASS: master {VERSION}, {len(receipt["packages"])} workspace packages, '
          f'{len(manifest["patches"])} exact patches and three Android addons')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('receipt', type=Path)
    parser.add_argument('assets', type=Path)
    check(**vars(parser.parse_args()))
