#!/usr/bin/env python3
"""Assemble Android's pinned Harness master over a public Termux base.

Consumes the source-built CLI+Web pnpm deployment and own compiled plugins.
Does not use a device, installed runtime, user profile, or donor APK.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

from lib.master_deck_patch import stage as stage_deck
from lib.master_runtime_patch import patch_boot, patch_search
from lib.master_deploy_links import materialize
from lib.codex_context_patch import patch_agent_loop, patch_attachment_store
from lib.legacy_codex_migration import (patch_legacy_codex_migration,
    patch_legacy_live_migration, patch_legacy_android_v4_migration)

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.2.1-alpha.2'
COMMIT = 'd743267388641bc76f17c45ce8b4c231aed1d32c'


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def install_package(source, profile):
    first.copy_package(source, profile)
    meta = json.loads((source/'package.json').read_text())
    target = profile/'node_modules'/meta['name']
    for name in ('dsh-compat.mjs', 'dsh-client-compat.mjs', 'codex-activity-wire.mjs'):
        if (source/name).exists(): shutil.copy2(source/name, target/name)
    # The legacy client-runtime package only supplied the browser context.
    # Runtime imports in these plugins are type-only. Connection is the real
    # bootstrap dependency in both source-built Web and the old mobile engine.
    inject = meta.get('dsh', {}).get('client', {}).get('inject', [])
    if '@deepseek-ai/dsh-client-runtime' in inject:
        meta['dsh']['client']['inject'] = [
            '@deepseek-ai/dsh-client-connection' if name == '@deepseek-ai/dsh-client-runtime' else name
            for name in inject]
        (target/'package.json').write_text(json.dumps(meta, indent=2)+'\n')
    return target


first = module('first_build', ROOT/'scripts/first-build.py')


def stage_licenses(source, engine, assets):
    source, engine, assets = map(Path, (source,engine,assets))
    shutil.copy2(source/'LICENSE', engine/'LICENSE')
    license_assets = assets/'licenses'
    license_assets.mkdir(parents=True, exist_ok=True)
    for origin, name in [(source/'LICENSE','deepseek-harness-MIT.txt'),
        (source/'native/system/LICENSE','node-addon-system-BSD-3-Clause.txt'),
        (ROOT/'scripts/runtime-sharp-wasm/node_modules/@img/sharp-wasm32/LICENSE','sharp-wasm-Apache-2.0.txt'),
        (ROOT/'scripts/runtime-sharp-wasm/node_modules/@img/sharp-wasm32/README.md','sharp-wasm-THIRD-PARTY-NOTICES.md')]:
        shutil.copy2(origin, license_assets/name)
    shutil.copy2(source/'native/system/LICENSE', engine/'node_modules/@deepseek-ai/node-addon-system/LICENSE')


def stage(source, deploy, runtime, assets, native, resume=False):
    source, deploy, runtime, assets, native = map(lambda p: Path(p).resolve(),
        (source, deploy, runtime, assets, native))
    if json.loads((deploy/'package.json').read_text())['version'] != VERSION:
        raise RuntimeError('Wrong source-built engine')
    first.fetch_base()
    if runtime.exists() and not resume: raise RuntimeError('Use a new disposable runtime directory')
    if resume and (ROOT/'.local' not in runtime.parents or not (runtime/'.master-overlay.json').is_file()):
        raise RuntimeError('Resume requires this checkout\'s generated master runtime receipt')
    if not resume:
        runtime.mkdir(parents=True)
        subprocess.run(['tar', '--no-same-owner', '-xJf', first.ARCHIVE, '-C', runtime], check=True)
    engine = runtime/'usr/lib/node_modules/@deepseek-ai/dsh'
    if engine.is_symlink() or runtime not in engine.resolve().parents:
        raise RuntimeError('Engine staging escaped the new runtime')
    if resume:
        # Preserve generated patches/native addons while adding newly resolved
        # dependencies. Only this script's isolated generated runtime is eligible.
        subprocess.run(['rsync','-a','--ignore-existing','--exclude=*.map',str(deploy)+'/',str(engine)+'/'], check=True)
        shutil.copy2(deploy/'package.json', engine/'package.json')
    else:
        shutil.rmtree(engine)
        shutil.copytree(deploy, engine, symlinks=True, ignore=shutil.ignore_patterns('*.map'))
    nm = engine/'node_modules'
    print('Production deployment copied', flush=True)
    canonical = nm/'@deepseek-ai'
    canonical.mkdir(exist_ok=True)
    packages = materialize(engine, source, android=True)
    # app-boot imports Group at runtime but declares it as a workspace peer.
    # The production deploy must include it explicitly (prepare-master-engine).
    if not list((nm/'.pnpm').glob('@deepseek-ai+cordis-plugin-group@*')):
        raise RuntimeError('CLI production closure is missing cordis-plugin-group')
    for scope in sorted((nm/'.pnpm').glob('*/node_modules/@deepseek-ai')):
        for pkg in scope.iterdir():
            if pkg.is_symlink() or not (pkg/'package.json').is_file(): continue
            meta = json.loads((pkg/'package.json').read_text())
            name = meta['name']
            if name in packages and packages[name] != meta['version']:
                raise RuntimeError('Multiple upstream package versions: '+name)
            packages[name] = meta['version']
            alias = canonical/pkg.name
            if not alias.exists(): alias.symlink_to(os.path.relpath(pkg, alias.parent))
    # Desktop prebuilds are not Android executables. Real Android addons are
    # built from pinned inputs below; Sharp uses its official WASM fallback.
    for path in engine.rglob('*'):
        if path.is_symlink() or not path.is_file(): continue
        if path.suffix in ('.node', '.so', '.dll', '.dylib', '.exe') or '.so.' in path.name:
            path.unlink()
    print('Desktop native prebuilds removed', flush=True)
    for package in (nm/'.pnpm').glob('@vscode+ripgrep-*/node_modules/@vscode/ripgrep-*'):
        if (package/'bin').is_dir(): shutil.rmtree(package/'bin')
    for name in ('@img/sharp-wasm32', '@emnapi/runtime', 'tslib'):
        origin = ROOT/'scripts/runtime-sharp-wasm/node_modules'/name
        if not origin.is_dir(): raise RuntimeError('Run npm ci --force in scripts/runtime-sharp-wasm')
        dest = nm/name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(origin, dest, symlinks=True, dirs_exist_ok=True)
    system = canonical/'node-addon-system'
    (system/'android-arm64').mkdir(exist_ok=True)
    shutil.copy2(native/'android-flock/system.node', system/'android-arm64/system.node')
    shutil.copy2(native/'android-flock/flock.js', system/'lib/flock.js')
    shutil.copy2(source/'native/system/LICENSE', system/'LICENSE')
    stage_licenses(source, engine, assets)
    for name, binary in [('node-pty','pty.node'), ('koffi','koffi.node')]:
        candidates = list((nm/'.pnpm').glob(name+'@*/node_modules/'+name))
        if len(candidates) != 1: raise RuntimeError('Ambiguous native package '+name)
        dest = candidates[0]/('build/Release' if name == 'node-pty' else 'build/koffi/android_arm64')
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(native/('android-pty' if name == 'node-pty' else 'android-koffi')/binary, dest/binary)
    patches = assets/'patched'
    print('Android addons and Sharp WASM installed', flush=True)
    patches.mkdir(parents=True, exist_ok=True)
    records = []
    originals = {}
    for directory, children, files in os.walk(source):
        children[:] = [name for name in children if name not in ('node_modules','.git','lib','dist')]
        if 'package.json' in files:
            meta = json.loads((Path(directory)/'package.json').read_text())
            originals[meta.get('name')] = Path(directory)
    def original(name):
        return (originals['@deepseek-ai/'+name]/'lib/index.js')
    def update(name, relative, data, base=None):
        pkg = canonical/name
        target = pkg/relative
        raw = target.read_bytes()
        asset = 'master-'+name+'-'+Path(relative).stem
        (patches/(asset+'.js')).write_bytes(data)
        target.write_bytes(data)
        records.append({'name':'@deepseek-ai/'+name, 'version':VERSION,
            'relative':relative, 'patch':asset, 'baseline':base or hashlib.sha256(raw).hexdigest(),
            'sha256':hashlib.sha256(data).hexdigest()})
    deck = native/'deck-patches'
    manifest = stage_deck(source, deck)
    for name, hashes in manifest['packages'].items():
        update(name, 'lib/client.js', (deck/(name+'.js')).read_bytes(), hashes['base'])
    update('dsh-app-boot', 'lib/index.js', patch_boot(original('dsh-app-boot').read_bytes()), digest(original('dsh-app-boot')))
    update('dsh-tool-fs-search', 'lib/index.js', patch_search(original('dsh-tool-fs-search').read_bytes()), digest(original('dsh-tool-fs-search')))
    update('dsh-agent-loop', 'lib/index.js', patch_agent_loop(original('dsh-agent-loop').read_text()).encode(), digest(original('dsh-agent-loop')))
    update('dsh-attachment-local', 'lib/index.js', patch_attachment_store(original('dsh-attachment-local').read_text()).encode(), digest(original('dsh-attachment-local')))
    migration_bases = {'dsh-session-format-v1-to-v2':'b2b401d880bb000017ba8663c4448b501427b23a1cd2f9fdb04cb7ec9d763eff',
        'dsh-session-format-v2-to-v3':'0dc56fb447e9046fc25995bcd08dbac26e832eba6e9eb583ef49d26467c27cd7',
        'dsh-session-format-v3-to-v4':'a6b974d110572bd0b16aa7ab09a30d9061944e8dc9f811e8c4a35e4891f83f12'}
    for name, patcher in [('dsh-session-format-v1-to-v2',patch_legacy_codex_migration),
        ('dsh-session-format-v2-to-v3',patch_legacy_live_migration),
        ('dsh-session-format-v3-to-v4',patch_legacy_android_v4_migration)]:
        update(name, 'lib/index.js', patcher(original(name).read_text()).encode(), migration_bases[name])
    catalog = module('model_catalog', ROOT/'scripts/patch-model-catalog.py')
    update('dsh-api-session-controller', 'lib/index.js', catalog.patch(original('dsh-api-session-controller').read_bytes()).encode(), digest(original('dsh-api-session-controller')))
    # Reuse the reviewed exclusive-publication implementation, with the new
    # source bundle's matching anchors. The new native writer lock remains on.
    subprocess.run(['node', ROOT/'android-shell/scripts/patches/apply-patches.mjs', runtime,
        '--scope','engine','--only','spj-migration-link-F5,publish-exclusive-F7','--apply'], check=True)
    persistence = canonical/'dsh-session-persistence-jsonl/lib/index.js'
    update('dsh-session-persistence-jsonl', 'lib/index.js', persistence.read_bytes(),
        '027803dde72aac7038253f0a8ff9fdcdbf0eb8cad53ed26efa3ec610f01587e7')
    profile = runtime/'home/.dsh/profiles/web'
    for folder in first.PLUGINS + ['dsh-host-web-compat', 'vendor/dsh-undo-savepoint',
        'vendor/dshmarketplace-plugin','vendor/relay-dsh-plugin-codex','vendor/relay-dsh-plugin-session-import']:
        install_package(ROOT/'android-shell'/folder, profile)
    subprocess.run(['node', ROOT/'android-shell/scripts/patches/apply-patches.mjs',profile/'node_modules',
        '--scope','vendor','--apply'], check=True)
    composition = (ROOT/'android-shell/scripts/profile-web.cordis.patch.yml').read_text()
    ids = {'dsh-android-fs':'fs-android','dsh-android-debian':'android-debian',
        'dsh-android-codex':'android-codex','dsh-codex-live':'codex-live',
        'dsh-android-voice-input':'android-voice-input','dsh-android-performance':'android-performance',
        'dsh-speech-services':'speech-services','dsh-startup-appearance':'startup-appearance',
        'dsh-xiaomi-remote':'xiaomi-remote','dsh-task-notifications':'task-notifications',
        'relay-dsh-plugin-codex':'android-codex-client','relay-dsh-plugin-session-import':'android-codex-import'}
    for folder in first.PLUGINS + ['vendor/relay-dsh-plugin-codex','vendor/relay-dsh-plugin-session-import']:
        meta = json.loads((ROOT/'android-shell'/folder/'package.json').read_text())
        name = meta['name']
        if name in composition: continue
        ident = ids.get(Path(folder).name, Path(folder).name)
        config = '      config:\n        androidClientOnly: true\n' if ident == 'android-codex-client' else ''
        disabled = '      disabled: true\n' if ident == 'android-performance' else ''
        composition += f"\n- insert:\n    - id: {ident}\n      name: '{name}'\n"+config+disabled
    composition += '\n- id: fs-sandbox\n  disabled: true\n'
    (profile/'cordis.patch.yml').write_text(composition)
    module('retired_plugins', ROOT/'android-shell/scripts/retired_plugins.py').retire_tree(runtime)
    bundle = ROOT/'.tools/debian-bundle/arm64'
    if not (bundle/'manifest.json').is_file(): raise RuntimeError('Prepare public Debian inputs first')
    shutil.copytree(bundle, runtime/'usr/share/dsh-debian', dirs_exist_ok=True)
    skills = runtime/'home/.dsh/codex-android/home/skills'
    for folder in (ROOT/'android-shell/codex-skills').iterdir():
        if folder.is_dir() and folder.name != 'say':
            shutil.copytree(folder, skills/folder.name, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('__pycache__'))
    (assets/'master-runtime-patches.json').write_text(json.dumps({'engine':VERSION,
        'commit':COMMIT,'patches':records}, indent=2)+'\n')
    receipt = {'engine':VERSION,'commit':COMMIT,'packages':packages,
        'base_sha256':first.BASE_SHA,'patches':records,
        'native':{name:json.loads((native/name/'manifest.json').read_text())
            for name in ('android-flock','android-pty','android-koffi')}}
    (runtime/'.master-overlay.json').write_text(json.dumps(receipt, indent=2)+'\n')
    (native/'master-runtime.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print('Staged', VERSION, 'with',len(packages),'upstream packages')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source','deploy','runtime','assets','native'):
        parser.add_argument('--'+name, required=True, type=Path)
    parser.add_argument('--resume', action='store_true')
    stage(**vars(parser.parse_args()))
