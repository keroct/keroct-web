import contextlib
import hashlib
import importlib.util
import io
import os
import re
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPOSITORY_ROOT / "scripts" / "prepare-pages-artifact.py"
SCRIPT_SPEC = importlib.util.spec_from_file_location("prepare_pages_artifact", SCRIPT_PATH)
if SCRIPT_SPEC is None or SCRIPT_SPEC.loader is None:
    raise RuntimeError(f"Cannot load {SCRIPT_PATH}")
prepare_pages_artifact = importlib.util.module_from_spec(SCRIPT_SPEC)
sys.modules[SCRIPT_SPEC.name] = prepare_pages_artifact
SCRIPT_SPEC.loader.exec_module(prepare_pages_artifact)


class PreparePagesArtifactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.source = self.root / "_site"
        self.source.mkdir()
        self._write_fixture()

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    @staticmethod
    def _fixture_bytes(relative_path: str) -> bytes:
        if relative_path in {
            "tools/windows/obs-tawk-quiet/index.html",
            "tools/windows/obs-tawk-quiet/VERIFICATION.html",
        }:
            return (
                '<link rel="stylesheet" '
                'href="/keroct-web/assets/css/style.css?v=1831a0a0f6cf705c9e84f2a9efda277bad776c37">\n'
            ).encode("ascii")
        if relative_path == "assets/fonts/OFL.txt":
            return b"OFL license fixture\n"
        if relative_path == "assets/fonts/ZenKakuGothicNew-Black.ttf":
            return b"font fixture bytes\x00\x01\xff"
        if relative_path == "assets/ogp.jpg":
            return b"ogp fixture bytes\xff\xd8\xff\xd9"
        return f"fixture:{relative_path}\n".encode("utf-8")

    def _write_fixture(self) -> None:
        for relative_path in prepare_pages_artifact.SELECTED_PATHS:
            path = self.source.joinpath(*relative_path.split("/"))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(self._fixture_bytes(relative_path))

        extras = {
            "README.md": b"repository documentation\n",
            "assets/css/extra.css": b"unlisted stylesheet should stay in GitHub only\n",
            "data/pricing.json": b"{\"source\": true}\n",
            "docs/pricing-source-notes.md": b"source notes\n",
            "scripts/render-pricing.py": b"print('fixture')\n",
        }
        for relative_path, contents in extras.items():
            path = self.source.joinpath(*relative_path.split("/"))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)

    def _source_hashes(self) -> dict[str, str]:
        return {
            path.relative_to(self.source).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in self.source.rglob("*")
            if path.is_file()
        }

    def test_selects_exact_site_and_tool_manifest(self) -> None:
        destination = self.root / "_pages"
        before = self._source_hashes()

        result = prepare_pages_artifact.prepare_pages_artifact(self.source, destination)

        self.assertEqual(result.site_files, 24)
        self.assertEqual(result.tool_files, 19)
        self.assertEqual(result.total_files, 43)
        output_paths = {
            path.relative_to(destination).as_posix()
            for path in destination.rglob("*")
            if path.is_file()
        }
        self.assertEqual(output_paths, set(prepare_pages_artifact.SELECTED_PATHS))
        self.assertFalse((destination / "README.md").exists())
        self.assertTrue((destination / "assets" / "css" / "style.css").is_file())
        self.assertFalse((destination / "assets" / "css" / "extra.css").exists())
        self.assertFalse((destination / "data").exists())
        self.assertFalse((destination / "docs").exists())
        self.assertFalse((destination / "scripts").exists())
        self.assertEqual(
            (destination / "tools/windows/obs-tawk-quiet/Build.ps1").read_bytes(),
            b"fixture:tools/windows/obs-tawk-quiet/Build.ps1\n",
        )
        self.assertTrue((destination / "tools/windows/obs-tawk-quiet/Manage.ps1").is_file())
        self.assertTrue((destination / "tools/windows/obs-tawk-quiet/src/Program.cs").is_file())
        self.assertTrue((destination / "tools/windows/obs-tawk-quiet/README.md").is_file())
        self.assertTrue((destination / "tools/windows/obs-tawk-quiet/index.html").is_file())
        self.assertTrue((destination / "tools/windows/obs-tawk-quiet/VERIFICATION.html").is_file())
        stylesheet_href = "/keroct-web/assets/css/style.css?v=1831a0a0f6cf705c9e84f2a9efda277bad776c37"
        stylesheet_relative_path = stylesheet_href.split("/keroct-web/", 1)[1].split("?", 1)[0]
        for generated_page in ("index.html", "VERIFICATION.html"):
            page = destination / "tools/windows/obs-tawk-quiet" / generated_page
            match = re.search(r'href="([^"]+)"', page.read_text(encoding="ascii"))
            self.assertIsNotNone(match)
            self.assertEqual(match.group(1), stylesheet_href)
            self.assertTrue((destination / stylesheet_relative_path).is_file())
        self.assertEqual(
            (destination / "assets/fonts/OFL.txt").read_bytes(),
            b"OFL license fixture\n",
        )
        self.assertEqual(
            (destination / "assets/css/style.css").read_bytes(),
            b"fixture:assets/css/style.css\n",
        )
        self.assertEqual(
            (destination / "assets/fonts/ZenKakuGothicNew-Black.ttf").read_bytes(),
            b"font fixture bytes\x00\x01\xff",
        )
        self.assertEqual(
            (destination / "assets/ogp.jpg").read_bytes(),
            b"ogp fixture bytes\xff\xd8\xff\xd9",
        )
        self.assertEqual(before, self._source_hashes())

    def test_cli_reports_selection_counts(self) -> None:
        destination = self.root / "_pages"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = prepare_pages_artifact.main(
                ["--source", str(self.source), "--destination", str(destination)]
            )
        self.assertEqual(exit_code, 0)
        self.assertIn("Selected 43 files", output.getvalue())
        self.assertIn("24 site runtime", output.getvalue())
        self.assertIn("19 Windows tool", output.getvalue())

    def test_missing_required_path_fails_before_creating_destination(self) -> None:
        missing = self.source / "pricing/index.html"
        missing.unlink()
        destination = self.root / "_pages"

        with self.assertRaisesRegex(prepare_pages_artifact.ArtifactError, "pricing/index.html"):
            prepare_pages_artifact.prepare_pages_artifact(self.source, destination)

        self.assertFalse(destination.exists())
        self.assertTrue(self.source.exists())

    def test_rejects_overlapping_destination(self) -> None:
        with self.assertRaisesRegex(prepare_pages_artifact.ArtifactError, "overlap"):
            prepare_pages_artifact.prepare_pages_artifact(self.source, self.source / "_pages")

    def test_rejects_nonempty_destination(self) -> None:
        destination = self.root / "_pages"
        destination.mkdir()
        (destination / "stale.txt").write_text("stale", encoding="utf-8")

        with self.assertRaisesRegex(prepare_pages_artifact.ArtifactError, "empty"):
            prepare_pages_artifact.prepare_pages_artifact(self.source, destination)

    def test_rejects_immediate_destination_parent_symlink(self) -> None:
        destination = self.root / "linked-parent" / "_pages"

        with mock.patch.object(Path, "is_symlink", autospec=True) as is_symlink:
            is_symlink.side_effect = lambda path: path == destination.parent
            with self.assertRaisesRegex(prepare_pages_artifact.ArtifactError, "symlink"):
                prepare_pages_artifact.prepare_pages_artifact(self.source, destination)

        self.assertFalse(destination.exists())

    def test_rejects_selected_source_symlink(self) -> None:
        selected = self.source / "assets/ogp.jpg"
        selected.unlink()
        target = self.root / "outside.jpg"
        target.write_bytes(b"outside")
        try:
            os.symlink(target, selected)
        except (NotImplementedError, OSError) as exc:
            self.skipTest(f"symlink creation unavailable: {exc}")

        try:
            with self.assertRaisesRegex(prepare_pages_artifact.ArtifactError, "symlink"):
                prepare_pages_artifact.prepare_pages_artifact(self.source, self.root / "_pages")
        finally:
            selected.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
