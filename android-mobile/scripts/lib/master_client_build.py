"""Guard the pinned client compiler and remove host paths from CSS hashing."""
import hashlib
import re

SOURCE_SHA = '07a4c5ab94291026a4680d8c4bca11c64d54d3a5f4833713dfa1f571a6e50d75'


def canonicalize(raw):
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA:
        raise RuntimeError('Unaudited upstream client compiler')
    source = raw.decode()
    before = 'filename: fileId,'
    if source.count(before) != 3:
        raise RuntimeError('Unsupported upstream CSS compiler layout')
    source = source.replace(before, "filename: relative(REPOSITORY_ROOT, fileId).split(sep).join('/'),")
    return source.encode()


def normalize_regions(raw, source_root):
    """Normalize only compiler CSS region comments; keep executable bytes."""
    prefix = re.escape(str(source_root).replace('\\', '/') + '/')
    return re.sub(rb'(?m)^(\s*//#region \\0dsh-(?:css|global-css|inline-css):)' + prefix.encode(),
                  rb'\1', raw)
