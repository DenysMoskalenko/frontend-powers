#!/usr/bin/env python3
"""Type-check, lint and test every verifiable TypeScript snippet in skills/ inside a copy of the scaffold.

Stdlib only, Python 3.11+.

  ```ts,verify / ```tsx,verify            -> src/__verify__/<skill>-<file>-<n>.ts(x)       (tsc + Biome)
  ```ts,verify,test / ```tsx,verify,test  -> src/__verify__/<skill>-<file>-<n>.test.ts(x)  (tsc + Biome + Vitest)
  ```ts,ignore / ```tsx,ignore            -> deliberately wrong, skipped
  ```ts / ```tsx                          -> fragment, skipped

A verified block whose first line is `// file: <path>` is written at that path in the copy instead,
replacing the scaffold's file if one exists. Snippets must already be formatted: `biome check` fails
on a formatting difference.

The copy of skills/frontend-scaffolding/assets/app/ lives outside the repository (default:
$TMPDIR/frontend-powers-verify), because local plugin installs copy the repository whole.
Each skill is checked in its own fresh copy (one shared install), so an add-on skill's replacement of
src/app/router.tsx never meets another skill's. STACK.md's `## Add-on packages` are added to the copy's package.json and resolved on top of the
scaffold's lockfile. node_modules/ and the resolved lockfile are kept between runs while the scaffold's
package.json, lockfile and pnpm-workspace.yaml and the add-on block are unchanged.

Usage:
    python3 scripts/check_snippets.py [--dry-run] [--skip-tests]
    python3 scripts/check_snippets.py --only frontend-forms --verify-dir /tmp/verify-forms
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"
STACK = ROOT / "STACK.md"
ASSETS = SKILLS / "frontend-scaffolding" / "assets" / "app"
VERIFY = Path(tempfile.gettempdir()) / "frontend-powers-verify"
# Written into every directory this script generates; a directory without it is never deleted.
MARKER = ".generated-by-check-snippets"
# Hash of the install inputs of the last successful install; while it matches, node_modules/ and the lockfile are kept.
INSTALL_STAMP = ".install-inputs"
INSTALL_INPUTS = ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")
KEPT_ON_REUSE = {"node_modules", "pnpm-lock.yaml"}
SNIPPET_DIR = "src/__verify__"
TSCONFIG = "tsconfig.verify.json"
COPY_IGNORE = shutil.ignore_patterns(".git", "node_modules", "dist", "coverage", "test-results", "playwright-report", ".tanstack", ".DS_Store")
ADDON_KEYS = ("dependencies", "devDependencies")

VERIFY_TAGS = {"ts,verify", "tsx,verify", "ts,verify,test", "tsx,verify,test"}
SKIPPED_TAGS = {"ts", "tsx", "ts,ignore", "tsx,ignore"}
FILE_DIRECTIVE_RE = re.compile(r"^//\s*file:\s*(\S+)\s*$")

# Configuration written into the copy only. Example code declares things nobody uses, and a block
# without imports would otherwise be a script that shares one global scope with the others.
VERIFY_TSCONFIG = {"extends": "./tsconfig.json", "compilerOptions": {"moduleDetection": "force"}}
BIOME_OVERRIDE = {"includes": [f"{SNIPPET_DIR}/**"], "linter": {"rules": {"correctness": {"noUnusedVariables": "off"}}}}
# Running the scaffold's Vite config regenerates src/routeTree.gen.ts, so `// file: src/routes/...` blocks type-check.
ROUTE_TREE = "import { resolveConfig } from 'vite'; await resolveConfig({ mode: 'test', logLevel: 'error' }, 'serve');"


@dataclass
class Block:
    skill: str
    source: str  # path relative to ROOT
    line: int  # 1-based line of the opening fence
    tag: str
    code: str
    target: str = ""  # path inside the verify copy
    replaces: bool = False  # the target is a scaffold file

    @property
    def origin(self) -> str:
        return f"{self.source}:{self.line}"


@dataclass
class Stats:
    modules: int = 0
    tests: int = 0
    skipped: int = 0


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def target_for(block: Block, counter: int, errors: list[str]) -> str:
    ext = ".tsx" if block.tag.startswith("tsx") else ".ts"
    is_test = block.tag.endswith(",test")
    first = block.code.split("\n", 1)[0]
    m = FILE_DIRECTIVE_RE.match(first)
    if not m:
        stem = f"{slug(block.skill)}-{slug(Path(block.source).stem)}-{counter}"
        return f"{SNIPPET_DIR}/{stem}{'.test' if is_test else ''}{ext}"
    path = PurePosixPath(m.group(1))
    if path.is_absolute() or ".." in path.parts or path.parts[0] == "node_modules":
        errors.append(f"{block.origin}: `// file:` path {str(path)!r} must be relative to the app root, without '..'")
    elif not path.name.endswith(ext) or path.name.endswith(".d.ts"):
        errors.append(f"{block.origin}: `// file:` path {str(path)!r} must end in {ext} to match the ```{block.tag} tag")
    elif is_test != (".test." in path.name):
        errors.append(f"{block.origin}: `// file:` path {str(path)!r} {'needs' if is_test else 'must not have'} a .test{ext} name for ```{block.tag}")
    return str(path)


def extract(md: Path, skill: str, stats: Stats, errors: list[str]) -> list[Block]:
    lines = md.read_text(encoding="utf-8").splitlines()
    rel = md.relative_to(ROOT).as_posix()
    blocks: list[Block] = []
    i = 0
    while i < len(lines):
        if not lines[i].startswith("```"):
            i += 1
            continue
        tag = lines[i][3:].strip()
        open_line = i + 1
        j = i + 1
        while j < len(lines) and not lines[j].startswith("```"):
            j += 1
        code = "\n".join(lines[i + 1 : j]) + "\n"
        i = j + 1
        if tag in SKIPPED_TAGS:
            stats.skipped += 1
            continue
        if tag not in VERIFY_TAGS:
            continue
        if tag.endswith(",test"):
            stats.tests += 1
        else:
            stats.modules += 1
        block = Block(skill=skill, source=rel, line=open_line, tag=tag, code=code)
        block.target = target_for(block, len(blocks) + 1, errors)
        blocks.append(block)
    return blocks


def collect(errors: list[str]) -> tuple[list[Block], dict[str, Stats]]:
    blocks: list[Block] = []
    per_skill: dict[str, Stats] = {}
    for skill_dir in sorted(d for d in SKILLS.iterdir() if d.is_dir() and not d.name.startswith(".")):
        stats = per_skill.setdefault(skill_dir.name, Stats())
        for md in sorted(skill_dir.rglob("*.md")):
            if ASSETS in md.parents:  # the scaffold's own docs are not skill content
                continue
            blocks.extend(extract(md, skill_dir.name, stats, errors))
    return blocks, per_skill


def print_summary(per_skill: dict[str, Stats]) -> None:
    print(f"{'skill':<28}{'modules':>9}{'tests':>7}{'skipped':>9}")
    print("-" * 53)
    total = Stats()
    for name, s in per_skill.items():
        print(f"{name:<28}{s.modules:>9}{s.tests:>7}{s.skipped:>9}")
        total.modules += s.modules
        total.tests += s.tests
        total.skipped += s.skipped
    print("-" * 53)
    print(f"{'TOTAL':<28}{total.modules:>9}{total.tests:>7}{total.skipped:>9}\n")


def blame(output: str, blocks: list[Block]) -> list[str]:
    """`file.md:line` for every generated file the tool output names; the fence line when no line is given."""
    found: list[str] = []
    for b in blocks:
        lines = {m.group(1) for m in re.finditer(re.escape(b.target) + r"(?![\w.-])(?:[:(](\d+))?", output)}
        if lines - {None}:
            found += [f"  {b.target}:{n}  <-  {b.source}:{b.line + int(n)}" for n in sorted(lines - {None}, key=int)]
        elif lines:
            found.append(f"  {b.target}  <-  {b.origin}")
        stem, _, ext = b.target.rpartition(".")
        if b.replaces and f"{stem}.test.{ext}" in output:
            found.append(f"  {stem}.test.{ext} tests {b.target}, replaced by  {b.origin}")
    return found


def run(cmd: list[str], blocks: list[Block], verify: Path) -> bool:
    print(f"$ {' '.join(cmd)}   (in {verify})", flush=True)
    # Some pnpm setups still fail the install on the add-ons' unapproved build scripts despite --ignore-scripts.
    env = {**os.environ, "pnpm_config_strict_dep_builds": "false"}
    proc = subprocess.run(cmd, cwd=verify, text=True, capture_output=True, env=env)
    sys.stdout.write(proc.stdout)
    sys.stdout.flush()
    sys.stderr.write(proc.stderr)
    if proc.returncode == 0:
        return True
    output = proc.stdout + proc.stderr
    blamed = blame(output, blocks)
    replaced = [f"  {b.target}  <-  {b.origin}" for b in blocks if b.replaces]
    if blamed:
        print("\nFailing snippet(s) came from:", *blamed, sep="\n", file=sys.stderr)
    elif replaced:
        print("\nNo snippet named in the output. These snippets replace scaffold files the failure may depend on:", *replaced, sep="\n", file=sys.stderr)
    else:
        print("\nNo snippet named in the output; the scaffold or STACK.md's add-on block may be broken.", file=sys.stderr)
    if unformatted := re.findall(r"^(\S+) format ━", output, re.MULTILINE):
        print("\nSnippets must be formatted as Biome prints them above; fix the Markdown. To show one diff again:", file=sys.stderr)
        for path in unformatted:
            print(f"  cd {verify} && pnpm exec biome format {path}", file=sys.stderr)
    return False


def load_addons() -> dict[str, dict[str, str]] | str:
    """STACK.md's `## Add-on packages` JSON block, or an error message."""
    if not STACK.is_file():
        return "STACK.md not found; its '## Add-on packages' block lists the packages snippets may import"
    lines = STACK.read_text(encoding="utf-8").splitlines()
    start = next((i for i, ln in enumerate(lines) if re.match(r"^##\s+Add-on packages\s*$", ln)), None)
    if start is None:
        return "STACK.md has no '## Add-on packages' heading"
    fences = [i for i in range(start + 1, len(lines)) if lines[i].startswith("```")][:2]
    if len(fences) < 2 or any(lines[i].startswith("## ") for i in range(start + 1, fences[0])):
        return "STACK.md: no fenced JSON block under '## Add-on packages'"
    try:
        addons = json.loads("\n".join(lines[fences[0] + 1 : fences[1]]))
    except json.JSONDecodeError as exc:
        return f"STACK.md:{fences[0] + 1 + exc.lineno}: the '## Add-on packages' block is not valid JSON: {exc.msg}"
    if not isinstance(addons, dict) or set(addons) - set(ADDON_KEYS) or not all(
        isinstance(v, dict) and all(isinstance(p, str) for p in v.values()) for v in addons.values()
    ):
        return f"STACK.md: the '## Add-on packages' block must be an object with only {' and '.join(ADDON_KEYS)}, each mapping package names to versions"
    return addons


def install_inputs(addons: dict[str, dict[str, str]]) -> str:
    digest = hashlib.sha256(json.dumps(addons, sort_keys=True).encode())
    for name in INSTALL_INPUTS:
        digest.update(b"\0" + name.encode() + b"\0" + (ASSETS / name).read_bytes())
    return digest.hexdigest()


def prepare(verify: Path, blocks: list[Block], addons: dict[str, dict[str, str]]) -> str | None:
    """Regenerate the copy; returns an error message or None."""
    if verify == ROOT or ROOT in verify.parents:
        return f"{verify} is inside the repository; local plugin installs would copy its node_modules"
    stamp = verify / INSTALL_STAMP
    reuse = stamp.is_file() and stamp.read_text() == install_inputs(addons) and (verify / "node_modules").is_dir()
    if verify.exists():
        if not (verify / MARKER).is_file():
            return f"{verify} exists and was not generated by this script; refusing to delete it"
        for child in verify.iterdir():
            if reuse and child.name in KEPT_ON_REUSE | {INSTALL_STAMP, MARKER}:
                continue
            shutil.rmtree(child) if child.is_dir() and not child.is_symlink() else child.unlink()
    verify.mkdir(parents=True, exist_ok=True)
    (verify / MARKER).touch()
    ignore = (lambda d, names: COPY_IGNORE(d, names) | (KEPT_ON_REUSE & set(names) if Path(d) == ASSETS else set())) if reuse else COPY_IGNORE
    shutil.copytree(ASSETS, verify, ignore=ignore, dirs_exist_ok=True)
    package = json.loads((verify / "package.json").read_text(encoding="utf-8"))
    for key, packages in addons.items():
        package.setdefault(key, {}).update(packages)
    (verify / "package.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    for b in blocks:
        path = verify / b.target
        b.replaces = (ASSETS / b.target).is_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(b.code, encoding="utf-8")
    (verify / TSCONFIG).write_text(json.dumps(VERIFY_TSCONFIG, indent=2) + "\n", encoding="utf-8")
    biome = verify / "biome.json"
    if not biome.is_file():
        return f"{ASSETS.relative_to(ROOT)}/biome.json not found"
    config = json.loads(biome.read_text(encoding="utf-8"))
    config.setdefault("overrides", []).append(BIOME_OVERRIDE)
    biome.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="extract and summarize only; write and install nothing")
    parser.add_argument("--skip-tests", action="store_true", help="stop after Biome; do not run Vitest")
    parser.add_argument("--only", nargs="+", metavar="SKILL", help="check only these skills' snippets")
    parser.add_argument("--verify-dir", type=Path, default=VERIFY, help=f"where the generated copy goes (default: {VERIFY}); rebuilt on every run")
    args = parser.parse_args()
    verify = args.verify_dir.resolve()
    started = time.monotonic()

    if not SKILLS.is_dir():
        print("skills/ not found", file=sys.stderr)
        return 1

    errors: list[str] = []
    blocks, per_skill = collect(errors)
    print_summary(per_skill)
    if args.only:
        unknown = sorted(set(args.only) - set(per_skill))
        if unknown:
            print(f"--only: no such skill: {', '.join(unknown)}", file=sys.stderr)
            return 1
        blocks = [b for b in blocks if b.skill in args.only]
        errors = [e for e in errors if any(e.startswith(f"skills/{s}/") for s in args.only)]
        print(f"checking only: {', '.join(args.only)} ({len(blocks)} snippets)\n")
    # Each skill is verified in its own copy, so two skills may replace the same scaffold file; one skill may not.
    by_skill: dict[str, list[Block]] = {}
    for b in blocks:
        by_skill.setdefault(b.skill, []).append(b)
    for skill_blocks in by_skill.values():
        targets: dict[str, Block] = {}
        for b in skill_blocks:
            if b.target in targets:
                errors.append(f"{b.origin}: `// file: {b.target}` is also written by {targets[b.target].origin}")
            targets[b.target] = b
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    if args.dry_run:
        for b in blocks:
            print(f"{b.origin}  ->  {b.target}")
        if not ASSETS.is_dir():
            print(f"\nnote: {ASSETS.relative_to(ROOT)} does not exist yet, so a full run is not possible.")
        return 0

    if not ASSETS.is_dir():
        print(f"{ASSETS.relative_to(ROOT)} does not exist yet; use --dry-run until it lands.", file=sys.stderr)
        return 1
    addons = load_addons()
    if isinstance(addons, str):
        print(addons, file=sys.stderr)
        return 1
    commands = [
        # Not frozen: the add-ons are resolved on top of the scaffold's lockfile, under its pnpm-workspace.yaml policy.
        # No lifecycle scripts: add-ons bring build scripts (@swc/core, protobufjs) that type-checking never needs.
        ["pnpm", "install", "--no-frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
        # The injected configs are rewritten by json.dumps; let Biome own their formatting.
        ["pnpm", "exec", "biome", "format", "--write", "package.json", "biome.json", TSCONFIG],
        ["pnpm", "exec", "node", "--input-type=module", "-e", ROUTE_TREE],
        ["pnpm", "exec", "tsc", "-p", TSCONFIG],
        ["pnpm", "exec", "biome", "check", "--error-on-warnings", "--max-diagnostics=none"],
    ]
    if not args.skip_tests:
        commands.append(["pnpm", "exec", "vitest", "run"])

    failed: list[str] = []
    for skill, skill_blocks in by_skill.items():
        print(f"\n== {skill} ({len(skill_blocks)} snippets) ==", flush=True)
        if problem := prepare(verify, skill_blocks, addons):
            print(problem, file=sys.stderr)
            return 1
        for cmd in commands:
            if not run(cmd, skill_blocks, verify):
                failed.append(skill)
                break
            if cmd[1] == "install":
                (verify / INSTALL_STAMP).write_text(install_inputs(addons))
    if failed:
        print(f"\nFAILED: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"\n{len(blocks)} snippet(s) type-check, lint clean" + ("" if args.skip_tests else ", and tests pass") + f" ({time.monotonic() - started:.0f}s)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
