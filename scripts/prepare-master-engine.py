#!/usr/bin/env python3
"""Build the pinned public Harness CLI and complete Web deployment.

Requires the host toolchain described in ANDROID-BUILD-ENVIRONMENT.md. Source,
dependencies, generated files and receipts stay in an ignored local directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
from lib.master_workspace_closure import include_runtime_peers
from lib.master_deploy_links import materialize

ROOT = Path(__file__).resolve().parents[1]
COMMIT = 'd743267388641bc76f17c45ce8b4c231aed1d32c'
URL = 'https://github.com/deepseek-ai/deepseek-harness.git'
PNPM = '11.28.5'
VERSION = '0.2.1-alpha.2'


def run(argv, cwd, env):
    print('+', ' '.join(map(str, argv)), flush=True)
    subprocess.run(list(map(str, argv)), cwd=cwd, env=env, check=True)


def prepare(work):
    work = Path(work).resolve()
    if ROOT/'.local' not in work.parents:
        raise RuntimeError('Build inputs must be in this checkout\'s .local directory')
    work.mkdir(parents=True, exist_ok=True)
    source, deploy, repo = work/'source', work/'engine-master-deploy', work/'public-git'
    if source.exists() or deploy.exists():
        raise RuntimeError('Use a fresh build directory; existing work is not overwritten')
    repo.mkdir()
    env = dict(os.environ, LEFTHOOK='0', npm_config_cache=str(ROOT/'.tools/npm-cache'))
    run(['git','init','--bare'], repo, env)
    run(['git','fetch','--depth=1',URL,COMMIT], repo, env)
    actual = subprocess.check_output(['git','rev-parse','FETCH_HEAD'], cwd=repo, text=True).strip()
    if actual != COMMIT: raise RuntimeError('Wrong upstream commit')
    archive = work/'public-source.tar'
    with archive.open('wb') as output:
        subprocess.run(['git','archive',COMMIT], cwd=repo, env=env, stdout=output, check=True)
    source.mkdir()
    with tarfile.open(archive) as package:
        for member in package:
            if member.name.startswith('/') or '..' in Path(member.name).parts:
                raise RuntimeError('Unsafe public archive member')
        package.extractall(source, filter='data')
    # CLI's ordinary production closure omits Web until the profile is
    # installed. Android ships its factory profile offline, so make both
    # public bundles explicit deployment dependencies before resolving.
    cli = source/'apps/cli/package.json'
    meta = json.loads(cli.read_text())
    if meta['version'] != VERSION: raise RuntimeError('Wrong engine version')
    closure = include_runtime_peers(source)
    pnpm = ['npm','exec','--yes','--package=pnpm@'+PNPM,'--','pnpm']
    run(pnpm+['install','--lockfile-only','--ignore-scripts'], source, env)
    run(pnpm+['install','--frozen-lockfile','--ignore-scripts'], source, env)
    run(pnpm+['run','build'], source, env)
    run(pnpm+['--filter','@deepseek-ai/dsh','deploy','--prod','--legacy',deploy], source, env)
    materialize(deploy, source)
    receipt = {'commit':COMMIT,'url':URL,'engine':VERSION,'pnpm':PNPM,
        'public_source_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
        'deployment_bundles':['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app'],
        'runtime_workspace_closure':closure,
        'lock_sha256':hashlib.sha256((source/'pnpm-lock.yaml').read_bytes()).hexdigest()}
    (work/'source-build.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print('Built pinned public engine:', deploy)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, default=ROOT/'.local/master-engine')
    prepare(parser.parse_args().work)
