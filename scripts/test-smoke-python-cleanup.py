"""Prove Office smoke cleanup waits only for observed Windows sharing locks."""
import importlib.util
import ctypes
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runtime_smoke", Path(__file__).with_name("smoke-python-runtime.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def sharing_violation():
    error = PermissionError("owned executable image is still closing")
    error.winerror = 32
    return error


class OfficeCleanupTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "requires Windows file-sharing semantics")
    def test_actual_windows_file_lock_is_released_before_removal(self):
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        create = kernel.CreateFileW
        create.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                           ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
        create.restype = ctypes.c_void_p
        close = kernel.CloseHandle
        close.argtypes = [ctypes.c_void_p]
        close.restype = ctypes.c_int
        real_delete = shutil.rmtree
        handle = None
        observed_lock = False

        def delete(path):
            nonlocal handle, observed_lock
            try:
                real_delete(path)
            except OSError as error:
                self.assertEqual(error.winerror, 32)
                observed_lock = True
                self.assertTrue(close(handle))
                handle = None
                raise

        try:
            with patch.object(smoke.shutil, "rmtree", side_effect=delete):
                with smoke.office_temporary_directory() as directory:
                    image = Path(directory, "node.exe")
                    image.write_bytes(b"owned fixture")
                    handle = create(str(image), 0x80000000, 1, None, 3, 0, None)
                    self.assertNotIn(handle, [None, ctypes.c_void_p(-1).value])
            self.assertTrue(observed_lock)
            self.assertFalse(Path(directory).exists())
        finally:
            if handle is not None:
                close(handle)

    def test_sharing_lock_is_released_before_cleanup_returns(self):
        real_delete = shutil.rmtree
        calls = []

        def delete(path):
            calls.append(path)
            if len(calls) < 3:
                raise sharing_violation()
            real_delete(path)

        with patch.object(smoke, "IS_WINDOWS", True), patch.object(smoke.shutil, "rmtree", side_effect=delete), patch.object(smoke.time, "sleep"):
            with smoke.office_temporary_directory() as directory:
                Path(directory, "node.exe").write_bytes(b"owned fixture")
        self.assertFalse(Path(directory).exists())
        self.assertEqual(calls, [directory] * 3)

    def test_other_permission_errors_are_not_suppressed(self):
        with tempfile.TemporaryDirectory() as parent:
            directory = Path(parent, "owned")
            directory.mkdir()
            error = PermissionError("unrelated access denied")
            error.winerror = 5
            with patch.object(smoke.tempfile, "mkdtemp", return_value=str(directory)), patch.object(smoke, "IS_WINDOWS", True), patch.object(smoke.shutil, "rmtree", side_effect=error) as delete:
                with self.assertRaises(PermissionError):
                    with smoke.office_temporary_directory():
                        pass
            self.assertEqual(delete.call_count, 1)
            self.assertTrue(directory.exists())

    def test_persistent_sharing_lock_still_fails(self):
        with tempfile.TemporaryDirectory() as parent:
            directory = Path(parent, "owned")
            directory.mkdir()
            with patch.object(smoke.tempfile, "mkdtemp", return_value=str(directory)), patch.object(smoke, "IS_WINDOWS", True), patch.object(smoke.shutil, "rmtree", side_effect=sharing_violation()), patch.object(smoke.time, "monotonic", side_effect=[0, 6]):
                with self.assertRaises(PermissionError):
                    with smoke.office_temporary_directory():
                        pass
            self.assertTrue(directory.exists())

    def test_non_windows_lock_is_not_retried(self):
        with tempfile.TemporaryDirectory() as parent:
            directory = Path(parent, "owned")
            directory.mkdir()
            with patch.object(smoke.tempfile, "mkdtemp", return_value=str(directory)), patch.object(smoke, "IS_WINDOWS", False), patch.object(smoke.shutil, "rmtree", side_effect=sharing_violation()) as delete:
                with self.assertRaises(PermissionError):
                    with smoke.office_temporary_directory():
                        pass
            self.assertEqual(delete.call_count, 1)


if __name__ == "__main__":
    unittest.main()
