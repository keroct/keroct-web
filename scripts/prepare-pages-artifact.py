"""Select the public Pages artifact from the Jekyll output.

The repository contains source and distribution material that belongs in GitHub,
while the Pages artifact contains the site runtime and the public Windows tool.
The manifest below is deliberately explicit so a new source file cannot become a
Pages URL by accident.
"""

import argparse
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SITE_RUNTIME_PATHS = (
    "index.html",
    "pricing/index.html",
    "creators/kaerunoankake/index.html",
    "creators/sensuishi13/index.html",
    "assets/css/style.css",
    "assets/fonts/OFL.txt",
    "assets/fonts/ZenKakuGothicNew-Black.ttf",
    "assets/ogp.jpg",
    "assets/site-config.js",
    "assets/site.js",
    "assets/style.css",
    "assets/works/kaerunoankake/illustration.png",
    "assets/works/kaerunoankake/soyo-header.jpg",
    "assets/works/kaerunoankake/soyo-symbol.jpg",
    "assets/works/kaerunoankake/suichan-logo.jpg",
    "assets/works/kaerunoankake/suichan-stream.jpg",
    "assets/works/kaerunoankake/tept-logo.jpg",
    "assets/works/sensuishi13/profile.png",
    "assets/works/sensuishi13/work-01.jpg",
    "assets/works/sensuishi13/work-02.jpg",
    "assets/works/sensuishi13/work-03.jpg",
    "assets/works/sensuishi13/work-04.jpg",
    "assets/works/sensuishi13/work-05.jpg",
    "assets/works/sensuishi13/work-06.jpg",
)

TOOL_PUBLIC_PATHS = (
    "tools/windows/obs-tawk-quiet/Build.ps1",
    "tools/windows/obs-tawk-quiet/Install.cmd",
    "tools/windows/obs-tawk-quiet/Manage.ps1",
    "tools/windows/obs-tawk-quiet/README.md",
    "tools/windows/obs-tawk-quiet/Status.cmd",
    "tools/windows/obs-tawk-quiet/Test.ps1",
    "tools/windows/obs-tawk-quiet/Uninstall.cmd",
    "tools/windows/obs-tawk-quiet/VERIFICATION.html",
    "tools/windows/obs-tawk-quiet/VERIFICATION.md",
    "tools/windows/obs-tawk-quiet/WindowsIntegration.ps1",
    "tools/windows/obs-tawk-quiet/index.html",
    "tools/windows/obs-tawk-quiet/src/CoreAudio.cs",
    "tools/windows/obs-tawk-quiet/src/Policy.cs",
    "tools/windows/obs-tawk-quiet/src/ProcessList.cs",
    "tools/windows/obs-tawk-quiet/src/Program.cs",
    "tools/windows/obs-tawk-quiet/tests/AudioFixture.cs",
    "tools/windows/obs-tawk-quiet/tests/InstallRollbackTests.ps1",
    "tools/windows/obs-tawk-quiet/tests/PolicyTests.cs",
    "tools/windows/obs-tawk-quiet/tests/WindowsTests.cs",
)

SELECTED_PATHS = SITE_RUNTIME_PATHS + TOOL_PUBLIC_PATHS


class ArtifactError(RuntimeError):
    """Raised when the Pages artifact cannot be selected safely."""


@dataclass(frozen=True)
class SelectionResult:
    """Counts and canonical paths for one successful artifact selection."""

    source: Path
    destination: Path
    site_files: int
    tool_files: int

    @property
    def total_files(self) -> int:
        return self.site_files + self.tool_files


def _manifest_parts(relative_path: str) -> tuple[str, ...]:
    """Return safe path components for an explicit POSIX manifest entry."""

    if not relative_path or "\\" in relative_path:
        raise ArtifactError(f"Unsafe manifest path: {relative_path!r}")
    parts = tuple(relative_path.split("/"))
    if any(part in {"", ".", ".."} for part in parts):
        raise ArtifactError(f"Unsafe manifest path: {relative_path!r}")
    if Path(relative_path).is_absolute():
        raise ArtifactError(f"Unsafe manifest path: {relative_path!r}")
    return parts


def _validate_manifest() -> None:
    if len(SITE_RUNTIME_PATHS) != 24:
        raise ArtifactError("The site runtime manifest must contain 24 files")
    if len(TOOL_PUBLIC_PATHS) != 19:
        raise ArtifactError("The Windows tool manifest must contain 19 files")
    if len(set(SELECTED_PATHS)) != len(SELECTED_PATHS):
        raise ArtifactError("The Pages manifest contains duplicate paths")
    for relative_path in SELECTED_PATHS:
        _manifest_parts(relative_path)


def _canonical(path: os.PathLike[str] | str, *, strict: bool) -> Path:
    try:
        return Path(path).resolve(strict=strict)
    except OSError as exc:
        raise ArtifactError(f"Cannot resolve path {path!s}: {exc}") from exc


def _is_within(path: Path, root: Path) -> bool:
    """Use the host filesystem's comparison rules for overlap checks."""

    try:
        path_text = os.path.normcase(os.path.abspath(os.fspath(path)))
        root_text = os.path.normcase(os.path.abspath(os.fspath(root)))
        return os.path.commonpath((path_text, root_text)) == root_text
    except ValueError:
        return False


def _reject_symlink_ancestors(path: Path, *, label: str) -> None:
    """Reject a path that would enter an existing symlink before copying."""

    ancestors = list(path.parents)
    ancestors.reverse()
    for ancestor in ancestors:
        if ancestor.is_symlink():
            raise ArtifactError(f"{label} contains a symlink component: {ancestor}")


def _reject_source_symlinks(source_root: Path, relative_path: str) -> Path:
    parts = _manifest_parts(relative_path)
    current = source_root
    for part in parts:
        current /= part
        if current.is_symlink():
            raise ArtifactError(f"Selected source path is a symlink: {relative_path}")
    return current


def _validate_source_files(source_root: Path) -> list[tuple[str, Path]]:
    missing: list[str] = []
    selected: list[tuple[str, Path]] = []
    for relative_path in SELECTED_PATHS:
        candidate = _reject_source_symlinks(source_root, relative_path)
        if not candidate.exists():
            missing.append(relative_path)
            continue
        if not candidate.is_file():
            raise ArtifactError(f"Selected source path is not a file: {relative_path}")
        selected.append((relative_path, candidate))
    if missing:
        missing_list = ", ".join(missing)
        raise ArtifactError(f"Required Pages paths are missing: {missing_list}")
    return selected


def _prepare_destination(destination_input: Path, source_root: Path) -> Path:
    if destination_input.is_symlink():
        raise ArtifactError(f"Destination is a symlink: {destination_input}")
    _reject_symlink_ancestors(destination_input, label="Destination")
    destination_root = _canonical(destination_input, strict=False)
    if _is_within(destination_root, source_root) or _is_within(source_root, destination_root):
        raise ArtifactError("Source and destination paths overlap")
    if destination_input.exists():
        if not destination_input.is_dir():
            raise ArtifactError(f"Destination is not a directory: {destination_input}")
        try:
            has_existing_entries = next(destination_input.iterdir(), None) is not None
        except OSError as exc:
            raise ArtifactError(f"Cannot inspect destination {destination_input}: {exc}") from exc
        if has_existing_entries:
            raise ArtifactError(f"Destination must be empty: {destination_input}")
    else:
        destination_root.parent.mkdir(parents=True, exist_ok=True)
        destination_root.mkdir()
    return destination_root


def prepare_pages_artifact(
    source: os.PathLike[str] | str,
    destination: os.PathLike[str] | str,
) -> SelectionResult:
    """Copy the explicit Pages manifest from a Jekyll output directory."""

    _validate_manifest()

    source_input = Path(source)
    if source_input.is_symlink():
        raise ArtifactError(f"Source is a symlink: {source_input}")
    _reject_symlink_ancestors(source_input, label="Source")
    if not source_input.exists():
        raise ArtifactError(f"Source directory does not exist: {source_input}")
    if not source_input.is_dir():
        raise ArtifactError(f"Source is not a directory: {source_input}")
    source_root = _canonical(source_input, strict=True)

    selected = _validate_source_files(source_root)
    destination_root = _prepare_destination(Path(destination), source_root)

    for relative_path, source_path in selected:
        destination_path = destination_root.joinpath(*_manifest_parts(relative_path))
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        if destination_path.exists() or destination_path.is_symlink():
            raise ArtifactError(f"Destination path was populated during selection: {relative_path}")
        shutil.copy2(source_path, destination_path)

    return SelectionResult(
        source=source_root,
        destination=destination_root,
        site_files=len(SITE_RUNTIME_PATHS),
        tool_files=len(TOOL_PUBLIC_PATHS),
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Jekyll output directory")
    parser.add_argument("--destination", required=True, type=Path, help="Fresh Pages artifact directory")
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        result = prepare_pages_artifact(args.source, args.destination)
    except ArtifactError as exc:
        parser.error(str(exc))
    print(
        f"Selected {result.total_files} files for Pages artifact "
        f"({result.site_files} site runtime, {result.tool_files} Windows tool)"
    )
    print(f"Destination: {result.destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
