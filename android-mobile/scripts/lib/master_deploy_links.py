"""Materialize upstream's two link: overrides for a portable production tree."""
import json
import os
from pathlib import Path
import shutil


def links(root):
    pending = [root]
    while pending:
        for entry in os.scandir(pending.pop()):
            if entry.is_symlink():
                yield Path(entry.path)
            elif entry.is_dir(follow_symlinks=False):
                pending.append(Path(entry.path))


def materialize(engine, source, android=False):
    engine, source = Path(engine).resolve(), Path(source).resolve()
    modules = engine/'node_modules'
    packages = {}
    origins = [source/'vendor'/name for name in ('cosmokit','schemastery')]
    origins += [source/'native/system/packages'/name for name in
                ('darwin-arm64','darwin-x64','linux-arm64','linux-x64')]
    for origin in origins:
        meta = json.loads((origin/'package.json').read_text())
        target = modules/meta['name']
        if target.is_symlink():
            destination = Path(os.path.normpath(target.parent/os.readlink(target)))
            if engine in destination.parents:
                packages[meta['name']] = meta['version']
                continue
            target.unlink()
        target.mkdir(parents=True, exist_ok=True)
        # Only public source, compiled exports and notices. Never copy workspace
        # node_modules: their development links would recreate this problem.
        for item in origin.iterdir():
            if item.name in ('lib','src','bin') and item.is_dir():
                if android and item.name == 'bin': continue
                shutil.copytree(item,target/item.name,dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('*.map','*.tsbuildinfo'))
            elif item.name in ('package.json','LICENSE','README.md','prebuilds.json'):
                shutil.copy2(item,target/item.name)
        packages[meta['name']] = meta['version']
    changed = 0
    # Legacy deploy copies the workspace-wide hoist table, including benchmark,
    # desktop and test links outside the production closure. Repoint installed
    # packages locally and remove only extra source links from that hoist table.
    hoisted = modules/'.pnpm/node_modules'
    if hoisted.is_dir():
        for entry in os.scandir(hoisted):
            entries = list(os.scandir(entry.path)) if entry.name.startswith('@') and not entry.is_symlink() else [entry]
            for item in entries:
                if not item.is_symlink(): continue
                raw = os.readlink(item.path)
                if '/source/' not in raw: continue
                public = source/raw.split('/source/',1)[1]
                if source not in public.resolve().parents or not (public/'package.json').is_file():
                    raise RuntimeError('Unknown workspace hoist source')
                package = json.loads((public/'package.json').read_text())['name']
                target = modules/package
                Path(item.path).unlink()
                if target.exists():
                    Path(item.path).symlink_to(os.path.relpath(target,Path(item.path).parent))
                changed += 1
    for link in links(modules):
        raw = os.readlink(link)
        for origin in origins:
            if raw.rstrip('/').endswith('/source/'+origin.relative_to(source).as_posix()):
                package = json.loads((origin/'package.json').read_text())['name']
                link.unlink()
                link.symlink_to(os.path.relpath(modules/package,link.parent))
                changed += 1
                break
        # Every link is inspected, so lexical target containment suffices:
        # a later link in a chain cannot escape unnoticed. DirEntry type data
        # avoids a separate NTFS stat call for every ordinary file.
        destination = Path(os.path.normpath(link.parent/os.readlink(link)))
        if destination != engine and engine not in destination.parents:
            raise RuntimeError('Production link escaped engine: '+str(link.relative_to(engine)))
    if android:
        for name in ('darwin-arm64','darwin-x64','linux-arm64','linux-x64'):
            folder = modules/('@deepseek-ai/node-addon-system-'+name)/'bin'
            if folder.exists(): shutil.rmtree(folder)
    print(f'Materialized public workspace overrides; rewrote {changed} links',flush=True)
    return packages
