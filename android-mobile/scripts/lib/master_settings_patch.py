"""Recover only Android plugin sections rejected by the first master upgrade."""
import hashlib

SETTINGS_SHA = '9432b872597b7a31473072eb38a55979ab23375c76bd1d86d751388a692a0136'


def patch_settings(raw):
    if hashlib.sha256(raw).hexdigest() != SETTINGS_SHA:
        raise RuntimeError('Unsupported master settings importer')
    source = raw.decode()
    anchor = '\tasync importLegacyDocument() {'
    if source.count(anchor) != 1:
        raise RuntimeError('Missing master settings importer')
    source = source.replace('import { readFile, rename }', 'import { readFile, rename, writeFile }')
    source = source.replace('\t\tif (!existsSync(path)) return;', '\t\tif (!existsSync(path)) return this.recoverAndroidSettings();')
    source = source.replace('\t/** Register the calling plugin instance\'s page policy', '''\tasync recoverAndroidSettings() {
        const home = this.ownerContext.profileContext.home;
        const imported = join(home, "settings.yaml.imported");
        if (!existsSync(imported)) return;
        const marker = join(home, ".android-settings-recovered.json");
        const completed = existsSync(marker) ? JSON.parse(await readFile(marker, "utf8")) : [];
        if (!Array.isArray(completed) || completed.some(id => typeof id !== "string")) throw new Error("Invalid Android settings migration receipt");
        const sections = parse(await readFile(imported, "utf8"));
        // Never retry unrelated namespaces or overwrite a newer profile override.
        for (const ns of ["codex-live", "speech-services", "startup-appearance", "task-notifications", "xiaomi-remote"]) {
            if (completed.includes(ns) || !isPlainObject(sections?.[ns])) continue;
            const entry = this.ownerContext.configEditor.entries().find(row => row.options.id === ns && row.options.name === "@dsh-android/dsh-" + ns);
            if (!entry) continue;
            const schema = this.schema(entry);
            const form = schema && volatileForm(schema);
            const descriptor = this.describe().find(row => row.ns === ns);
            if (!form || !descriptor) continue;
            const user = isPlainObject(descriptor.user) ? descriptor.user : {};
            const patch = Object.fromEntries(Object.keys(form.dict ?? {}).filter(key => !Object.hasOwn(user, key) && Object.hasOwn(sections[ns], key)).map(key => [key, sections[ns][key]]));
            await this.update(ns, patch, descriptor.revision);
            completed.push(ns);
            await writeFile(marker + ".tmp", JSON.stringify(completed), {mode: 0o600});
            await rename(marker + ".tmp", marker);
        }
    }
\t/** Register the calling plugin instance's page policy''')
    return source.encode()
