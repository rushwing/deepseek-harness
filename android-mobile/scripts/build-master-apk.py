#!/usr/bin/env python3
"""Build the pinned Harness Android APK from public inputs in this checkout.

Activate scripts/env.sh first. Each phase owns its local outputs; this entry
never accesses a device or uses a previous APK as input.
"""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.local/master-engine'
PHASES = ('plugins', 'inputs', 'native', 'engine', 'sharp', 'flock', 'pty',
          'koffi', 'stage', 'package', 'apk')


def native_package(deploy, name):
    """Resolve one deployed native package, allowing pnpm patch suffixes."""
    deploy = Path(deploy).resolve()
    candidates = list((deploy / 'node_modules/.pnpm').glob(name + '@*/node_modules/' + name))
    if len(candidates) != 1 or not candidates[0].is_dir():
        raise RuntimeError('Missing or ambiguous deployed native package: ' + name)
    package = candidates[0].resolve()
    if not package.is_relative_to(deploy):
        raise RuntimeError('Deployed native package escapes its build directory')
    return package


def command(phase):
    """Resolve a command when its preceding build phases have completed."""
    def script(name, *args):
        return [sys.executable, str(ROOT / 'scripts' / name), *map(str, args)]
    source = WORK / 'source'
    deploy = WORK / 'engine-master-deploy'
    runtime = WORK / 'runtime'
    assets = WORK / 'assets'
    if phase in ('pty', 'koffi'):
        name = 'node-pty' if phase == 'pty' else 'koffi'
        return script('build-master-' + phase + '.py', native_package(deploy, name),
                      WORK / ('android-' + phase))
    return {
        **{phase: script('first-build.py', '--phase', phase)
           for phase in ('plugins', 'inputs', 'native', 'apk')},
        'engine': script('prepare-master-engine.py', '--work', WORK),
        'sharp': ['npm', '--prefix', str(ROOT / 'scripts/runtime-sharp-wasm'),
                  'ci', '--force', '--ignore-scripts', '--no-audit', '--no-fund'],
        'flock': script('build-master-flock.py', '--source', source,
                        '--output', WORK / 'android-flock'),
        'stage': script('stage-master-runtime.py', '--source', source,
                        '--deploy', deploy, '--runtime', runtime,
                        '--assets', assets, '--native', WORK),
        'package': script('package-master-runtime.py', '--source', source,
                          '--runtime', runtime, '--generated', assets,
                          '--receipt', WORK / 'master-runtime.json'),
    }[phase]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=('all', *PHASES), default='all',
                        help='Run one phase only when its preceding inputs are ready')
    args = parser.parse_args(argv)
    for phase in PHASES if args.phase == 'all' else (args.phase,):
        print('Build phase:', phase, flush=True)
        subprocess.run(command(phase), cwd=ROOT, check=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
