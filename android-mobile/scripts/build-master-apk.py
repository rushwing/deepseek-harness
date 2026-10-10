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


def commands():
    """Return the ordered public-source build commands, including APK checks."""
    def script(name, *args):
        return [sys.executable, str(ROOT / 'scripts' / name), *map(str, args)]
    source = WORK / 'source'
    deploy = WORK / 'engine-master-deploy'
    runtime = WORK / 'runtime'
    assets = WORK / 'assets'
    return {
        **{phase: script('first-build.py', '--phase', phase)
           for phase in ('plugins', 'inputs', 'native', 'apk')},
        'engine': script('prepare-master-engine.py', '--work', WORK),
        'sharp': ['npm', '--prefix', str(ROOT / 'scripts/runtime-sharp-wasm'),
                  'ci', '--force', '--ignore-scripts', '--no-audit', '--no-fund'],
        'flock': script('build-master-flock.py', '--source', source,
                        '--output', WORK / 'android-flock'),
        'pty': script('build-master-pty.py',
                      deploy / 'node_modules/.pnpm/node-pty@1.2.0-beta.15/node_modules/node-pty',
                      WORK / 'android-pty'),
        'koffi': script('build-master-koffi.py',
                        deploy / 'node_modules/.pnpm/koffi@3.1.1/node_modules/koffi',
                        WORK / 'android-koffi'),
        'stage': script('stage-master-runtime.py', '--source', source,
                        '--deploy', deploy, '--runtime', runtime,
                        '--assets', assets, '--native', WORK),
        'package': script('package-master-runtime.py', '--source', source,
                          '--runtime', runtime, '--generated', assets,
                          '--receipt', WORK / 'master-runtime.json'),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=('all', *PHASES), default='all',
                        help='Run one phase only when its preceding inputs are ready')
    args = parser.parse_args(argv)
    plan = commands()
    for phase in PHASES if args.phase == 'all' else (args.phase,):
        print('Build phase:', phase, flush=True)
        subprocess.run(plan[phase], cwd=ROOT, check=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
