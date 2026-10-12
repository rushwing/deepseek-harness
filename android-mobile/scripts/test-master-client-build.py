#!/usr/bin/env python3
"""Check that client compiler adaptation rejects unaudited input."""
import hashlib
import unittest
from unittest.mock import patch
from lib import master_client_build


class ClientBuildTests(unittest.TestCase):
    def test_unknown_compiler_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Unaudited'):
            master_client_build.canonicalize(b'unknown source')

    def test_exact_layout_is_required_and_all_css_paths_are_relative(self):
        source = b'filename: fileId,\n' * 3
        with patch.object(master_client_build, 'SOURCE_SHA', hashlib.sha256(source).hexdigest()):
            result = master_client_build.canonicalize(source)
        self.assertEqual(result.count(b'relative(REPOSITORY_ROOT, fileId)'), 3)
        source = b'filename: fileId,\n' * 2
        with patch.object(master_client_build, 'SOURCE_SHA', hashlib.sha256(source).hexdigest()):
            with self.assertRaisesRegex(RuntimeError, 'layout'):
                master_client_build.canonicalize(source)

    def test_region_normalization_leaves_executable_strings_untouched(self):
        raw = (b'\t//#region \\0dsh-css:/fixture/source/packages/client/file.module.css.mjs\n'
               b'const value = "/fixture/source/private-runtime-path";\n')
        result = master_client_build.normalize_regions(raw, '/fixture/source')
        self.assertEqual(result, (b'\t//#region \\0dsh-css:packages/client/file.module.css.mjs\n'
                                  b'const value = "/fixture/source/private-runtime-path";\n'))
        self.assertEqual(master_client_build.normalize_regions(raw, '/other/source'), raw)


if __name__ == '__main__':
    unittest.main()
