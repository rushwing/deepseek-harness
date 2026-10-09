#!/usr/bin/env python3
"""Start only a disposable host deployment and check the real Web entry point."""
import argparse
import os
import re
import shutil
import tempfile
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def check(engine, home, port):
    engine, home = Path(engine).resolve(), Path(home).resolve()
    if ROOT/'.local' not in home.parents:
        raise RuntimeError('Smoke test home must be isolated under .local')
    home.mkdir(parents=True, exist_ok=True)
    log = home/'host-smoke.log'
    # WSL's NTFS mount does not expose private POSIX modes. The upstream
    # credential store correctly rejects 0777 there, so use an empty Linux
    # temporary HOME and copy only this test's public profile configuration.
    temporary = tempfile.TemporaryDirectory(prefix='deepcode-master-smoke-')
    isolated = Path(temporary.name)
    profile = isolated/'profiles/web'
    profile.mkdir(parents=True)
    for name in ('package.json','cordis.yml','cordis.patch.yml'):
        origin = home/'profiles/web'/name
        if origin.is_file():
            (profile/name).write_text(origin.read_text().replace('__SMOKE_HOME__', str(isolated)))
    modules = home/'profiles/web/node_modules'
    if modules.is_dir():
        shutil.copytree(modules, profile/'node_modules', symlinks=True)
    env = dict(os.environ, DSH_HOME=str(isolated))
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    with log.open('wb') as output:
        process = subprocess.Popen(['node','--expose-internals',engine/'lib/bin.js',
            'web','--port',str(port),'--no-open'], env=env, stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic()+120
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'Host exited {process.returncode}; diagnostic: {log}')
                try:
                    token = re.search(r'\?token=([A-Za-z0-9_-]+)', log.read_text())
                    if not token:
                        time.sleep(.5)
                        continue
                    # The isolated profile generates its own token. Keep it in
                    # this private test, never print credentials or URLs with it.
                    url = f'http://127.0.0.1:{port}/?token='+token.group(1)
                    with opener.open(url, timeout=2) as response:
                        html = response.read().decode()
                    if '<html' not in html or '<script' not in html:
                        raise RuntimeError('Web entry is not the built frontend')
                    if 'disabling profile plugin row' in log.read_text():
                        raise RuntimeError(f'A bundled plugin was rejected; diagnostic: {log}')
                    print('PASS: isolated master CLI startup and real Web entry', flush=True)
                    return
                except (OSError, urllib.error.URLError):
                    time.sleep(.5)
            raise RuntimeError(f'Host startup timeout; diagnostic: {log}')
        finally:
            # This is our own isolated smoke process, never a user Agent.
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if (isolated/'logs').is_dir():
                shutil.copytree(isolated/'logs',home/'diagnostics',dirs_exist_ok=True)
            temporary.cleanup()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('engine', type=Path)
    parser.add_argument('home', type=Path)
    parser.add_argument('--port', type=int, default=3097)
    args = parser.parse_args()
    check(args.engine, args.home, args.port)
