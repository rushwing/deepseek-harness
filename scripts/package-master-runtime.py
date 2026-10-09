#!/usr/bin/env python3
"""Package the verified source-built master runtime for the Android APK."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-','_'),ROOT/'scripts'/(name+'.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def package(runtime, generated, receipt, source):
    runtime, generated, receipt, source = map(lambda p: Path(p).resolve(), (runtime,generated,receipt,source))
    first = module('first-build')
    data = json.loads(receipt.read_text())
    if data['engine'] != '0.2.1-alpha.2' or data['commit'] != 'd743267388641bc76f17c45ce8b4c231aed1d32c':
        raise RuntimeError('Wrong master receipt')
    assets = first.ASSETS
    stage = module('stage-master-runtime')
    stage.stage_licenses(source,
        runtime/'usr/lib/node_modules/@deepseek-ai/dsh', generated)
    profile = runtime/'home/.dsh/profiles/web'
    for folder in first.PLUGINS + ['dsh-host-web-compat','vendor/dsh-undo-savepoint',
        'vendor/dshmarketplace-plugin','vendor/relay-dsh-plugin-codex','vendor/relay-dsh-plugin-session-import']:
        stage.install_package(first.ANDROID/folder, profile)
    for directory in ('patched','licenses'):
        shutil.copytree(generated/directory, assets/directory, dirs_exist_ok=True)
    shutil.copy2(generated/'master-runtime-patches.json', assets/'master-runtime-patches.json')
    shutil.copy2(receipt, assets/'master-runtime.json')
    # Cold installs and managed plugin updates must receive the same metadata
    # and compiled sources as the runtime, including client connection injects.
    for name in ('stage-codex-live','stage-speech-services','stage-startup-appearance',
                 'stage-task-notifications','stage-xiaomi-remote'):
        module(name).stage(assets)
    own = {'voice-deck-client':'plugins/dsh-client-ui-voice-deck/lib/client.js',
        'codex-live-host':'plugins/dsh-android-codex/lib/index.js',
        'responsive-client-033':'dsh-client-ui-responsive/lib/client.js',
        'voice-input-client':'plugins/dsh-android-voice-input/lib/client.js',
        'codex-image-input':'vendor/relay-dsh-plugin-codex/lib/host-plugin.js'}
    for name, source in own.items():
        shutil.copy2(first.ANDROID/source, assets/'patched'/(name+'.js'))
    first.clean_runtime_sources(runtime/'home/.dsh/profiles/web/node_modules')
    stage.module('retired_plugins', ROOT/'android-shell/scripts/retired_plugins.py').retire_tree(runtime)
    first.WORK.mkdir(parents=True, exist_ok=True)
    first.pack_runtime(runtime, assets/'snapshot.tar.xz')
    (assets/'snapshot.sha256').write_text(first.digest(assets/'snapshot.tar.xz')+'\n')
    for license in (first.ANDROID/'LICENSES').glob('*.txt'):
        shutil.copy2(license, assets/'licenses'/license.name)
    (assets/'licenses/THIRD_PARTY_NOTICES.md').write_text(
        (first.ANDROID/'THIRD_PARTY_NOTICES.md').read_text())
    first.verify_runtime()
    print('PASS: master snapshot packaged and verified')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--generated', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    package(**vars(parser.parse_args()))
