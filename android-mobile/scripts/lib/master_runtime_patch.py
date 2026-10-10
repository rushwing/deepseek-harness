"""Version-locked Android host changes for the source-built Harness master."""
import hashlib


BOOT_SHA = '1ddbec4979030a905c099bfda1a3e20344bda6ed5a5f2dff31d9821020000e46'
SEARCH_SHA = '8d64d2e8a5310b442ae66bc0daf7d6957ec095dbe43cabd9eb208f7370e381ed'


def patch_search(raw):
    if hashlib.sha256(raw).hexdigest() != SEARCH_SHA:
        raise RuntimeError('Unsupported master search resolver')
    source = raw.decode()
    anchor = '\t\tconst executable = parse(process.execPath);'
    if source.count(anchor) != 1:
        raise RuntimeError('Missing master ripgrep resolver')
    return source.replace(anchor, '''        // The Android host supplies its pinned Termux search binary.
        if (process.platform === "android") {
            const prefix = process.env.TERMUX__PREFIX;
            if (!prefix || !isAbsolute(prefix)) throw new Error("Android search prefix unavailable");
            const binary = join(prefix, "bin/rg");
            if (!existsSync(binary)) throw new Error("Bundled Android ripgrep unavailable");
            return binary;
        }
''' + anchor).encode()


def patch_boot(raw):
    if hashlib.sha256(raw).hexdigest() != BOOT_SHA:
        raise RuntimeError('Unsupported master boot resolver')
    source = raw.decode()
    anchor = '\tconst addon = createRequire(import.meta.url)("node-addon-require-builtin");'
    if source.count(anchor) != 1:
        raise RuntimeError('Missing master internal module resolver')
    # EngineManager already starts Node with --expose-internals. All five
    # module-loader interfaces used here are available through that explicit
    # Node flag; preserve the upstream addon path for other invocations.
    return source.replace(anchor, '''\t// Android launcher explicitly exposes these loader internals.
    const require = createRequire(import.meta.url);
    const addon = process.execArgv.includes("--expose-internals")
        ? {requireBuiltin: id => require(id)}
        : require("node-addon-require-builtin");''').encode()
