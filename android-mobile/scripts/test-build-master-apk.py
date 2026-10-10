#!/usr/bin/env python3
"""Check fail-closed sequencing of the public master APK build entry."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('master_apk', Path(__file__).with_name('build-master-apk.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MasterApkTests(unittest.TestCase):
    def test_full_build_has_no_legacy_assemble_and_checks_actual_apk_last(self):
        with patch.object(module.subprocess, 'run') as run:
            module.main([])
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(len(commands), 11)
        self.assertTrue(commands[3][1].endswith('prepare-master-engine.py'))
        self.assertTrue(commands[-2][1].endswith('package-master-runtime.py'))
        self.assertEqual(commands[-1][-2:], ['--phase', 'apk'])
        self.assertFalse(any('assemble' in command for command in commands))
        self.assertTrue(all(call.kwargs == {'cwd': module.ROOT, 'check': True}
                            for call in run.call_args_list))

    def test_failure_stops_before_packaging(self):
        with patch.object(module.subprocess, 'run', side_effect=[None, subprocess.CalledProcessError(1, ['fixture'])]) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                module.main([])
        self.assertEqual(run.call_count, 2)

    def test_single_phase_is_explicit(self):
        with patch.object(module.subprocess, 'run') as run:
            module.main(['--phase', 'stage'])
        run.assert_called_once_with(module.commands()['stage'], cwd=module.ROOT, check=True)


if __name__ == '__main__':
    unittest.main()
