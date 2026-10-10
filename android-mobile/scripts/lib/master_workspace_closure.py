"""Include runtime workspace peers in an offline CLI deployment."""
import json
import os
from pathlib import Path


def include_runtime_peers(source):
    source = Path(source)
    packages = {}
    for directory, children, files in os.walk(source):
        children[:] = [name for name in children if name not in
                       ('node_modules', '.git', 'lib', 'dist', '.local')]
        if 'package.json' in files:
            metadata = json.loads((Path(directory)/'package.json').read_text())
            if metadata.get('name', '').startswith('@deepseek-ai/'):
                packages[metadata['name']] = metadata
    cli = source/'apps/cli/package.json'
    metadata = json.loads(cli.read_text())
    pending = list(metadata['dependencies']) + [
        '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
        '@deepseek-ai/cordis-plugin-group']
    visited = set()
    while pending:
        name = pending.pop()
        if name in visited or name not in packages:
            continue
        visited.add(name)
        package = packages[name]
        for field in ('dependencies', 'peerDependencies', 'optionalDependencies'):
            # Workspace peers describe runtime service packages even when pnpm
            # auto-install-peers is disabled. Their transitive peers matter too.
            pending.extend(dep for dep in package.get(field, {}) if dep in packages)
    for name in sorted(visited):
        if name != metadata['name']:
            metadata['dependencies'][name] = 'workspace:*'
    cli.write_text(json.dumps(metadata, indent=2)+'\n')
    return sorted(visited - {metadata['name']})
