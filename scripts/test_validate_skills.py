#!/usr/bin/env python3
"""Seed one violation per validator check into a temporary copy of the repository and assert the error.

Stdlib only, Python 3.11+, no network. Also covers the output-directory guard of build_eval_cases.py.

Usage:
    python3 scripts/test_validate_skills.py [-v]
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
COPY_IGNORE = shutil.ignore_patterns(".git", "node_modules", ".run", "__pycache__", "dist", "coverage", "test-results", "playwright-report", ".DS_Store")
GIT = ["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgSign=false", "-c", "init.defaultBranch=main"]

FORMS = Path("skills/frontend-forms")
SKILL = FORMS / "SKILL.md"
EVAL = Path("evals/frontend-forms.md")
SCAFFOLD = Path("skills/frontend-scaffolding/assets/app")
MANIFESTS = (".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", ".codex-plugin/plugin.json", ".cursor-plugin/plugin.json")


# --------------------------------------------------------------------------- seeding helpers


def read(c: Path, rel: Path | str) -> str:
    return (c / rel).read_text(encoding="utf-8")


def write(c: Path, rel: Path | str, text: str) -> None:
    path = c / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def sub(c: Path, rel: Path | str, pattern: str, repl: str, count: int = 1) -> None:
    """re.sub that fails when it changes nothing, so a seed can never silently become a no-op."""
    text, n = re.subn(pattern, repl, read(c, rel), count=count, flags=re.MULTILINE)
    if n == 0:
        raise AssertionError(f"seed pattern {pattern!r} matched nothing in {rel}")
    write(c, rel, text)


def append(c: Path, rel: Path | str, text: str) -> None:
    write(c, rel, read(c, rel) + text)


def first_reference(c: Path) -> Path:
    return sorted((c / FORMS / "references").glob("*.md"))[0].relative_to(c)


def stack_block(c: Path, heading: str) -> dict:
    text = read(c, "STACK.md")
    return json.loads(re.search(rf"^## {re.escape(heading)}\s*$.*?```json\n(.*?)```", text, re.MULTILINE | re.DOTALL).group(1))


def pin(c: Path, name: str) -> str:
    block = stack_block(c, "package.json")
    if name in ("pnpm", "node"):
        return block["devEngines"]["packageManager" if name == "pnpm" else "runtime"]["version"]
    return {**block["dependencies"], **block["devDependencies"]}[name]


def set_versions(c: Path, version: str) -> None:
    for rel in MANIFESTS:
        sub(c, rel, r'"version": "[^"]+"', f'"version": "{version}"', count=0)


def bump(version: str) -> str:
    major, minor, patch = (int(n) for n in version.split("."))
    return f"{major}.{minor}.{patch + 1}"


def skill_version(c: Path) -> str:
    return re.search(r'^\s+version: "([^"]+)"', read(c, SKILL), re.MULTILINE).group(1)


def rejected_name(c: Path) -> str:
    section = read(c, "STACK.md").split("## Rejected", 1)[1]
    row = next(ln for ln in section.splitlines() if ln.startswith("|") and "`" in ln.split("|")[1])
    return re.findall(r"`([^`]+)`", row.split("|")[1])[0]


def scope_block(c: Path) -> str:
    text = read(c, "scripts/validate_skills.py")
    body = re.search(r"^SCOPE_BLOCK = \((.*?)^\)", text, re.MULTILINE | re.DOTALL).group(1)
    return "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', body))


def set_scope_block(c: Path, paragraph: str) -> None:
    sub(c, SKILL, r"^Names such as .*$", paragraph.replace("\\", "\\\\"))


# --------------------------------------------------------------------------- cases


@dataclass
class Case:
    name: str
    seed: Callable[[Path], object]
    expect: str  # regex over the validator output
    args: tuple[str, ...] = ()
    present: bool = True  # False: the seed must NOT produce `expect`
    git: bool = False  # commit the copy and tag it `base` before seeding
    baseline_clean: bool = True  # `expect` must be absent before the seed
    output: str = field(default="", repr=False)
    baseline: str = field(default="", repr=False)


def S(path: Path) -> str:
    return re.escape(path.as_posix())


CASES: list[Case] = []


def case(name: str, seed: Callable[[Path], object], expect: str, *args: str, **kw: object) -> None:
    CASES.append(Case(name, seed, expect, args, **kw))  # type: ignore[arg-type]


# Frontmatter and description
case("frontmatter_present", lambda c: sub(c, SKILL, r"\A---\n", ""), r"missing YAML frontmatter")
case("frontmatter_closed", lambda c: sub(c, SKILL, r"^---\n\n# ", "\n# "), r"frontmatter is never closed")
case("frontmatter_allowed_keys", lambda c: sub(c, SKILL, r"^name: frontend-forms$", "name: frontend-forms\nlicense: MIT"), r"unknown frontmatter key 'license'")
case("metadata_holds_only_version", lambda c: sub(c, SKILL, r"^(\s+version: .*)$", r"\1\n  author: x"), r"unknown frontmatter key 'metadata.author'")
case("version_quoted", lambda c: sub(c, SKILL, r'^(\s+version: )"([^"]+)"', r"\1\2"), r"metadata.version must be quoted")
case("name_matches_directory", lambda c: sub(c, SKILL, r"^name: frontend-forms$", "name: frontend-formz"), r"must equal the directory name")
case("name_reserved_word", lambda c: sub(c, SKILL, r"^name: frontend-forms$", "name: claude-forms"), r"reserved word 'claude'")
case("description_double_quoted", lambda c: sub(c, SKILL, r'^description: "(.*)"$', r"description: '\1'"), r"description must be a double-quoted")
case("description_word_cap", lambda c: sub(c, SKILL, r'^description: "Use when ', 'description: "Use when ' + "word " * 80), r"words, max 75")
case("description_prefix", lambda c: sub(c, SKILL, r'^description: "Use when ', 'description: "When '), r"must start with \"Use when \"")
case("frontmatter_forbidden_chars", lambda c: sub(c, SKILL, r'^description: "Use when ', 'description: "Use when <x> '), r"frontmatter must not contain")
case(
    "descriptions_total",
    lambda c: [sub(c, p.relative_to(c), r'^description: "Use when ', 'description: "Use when ' + "x" * 400 + " ") for p in sorted((c / "skills").glob("*/SKILL.md"))],
    r"descriptions total \d+ chars",
)

# Budgets and skill layout
case("line_cap", lambda c: append(c, SKILL, "\nx\n" * 200), r"SKILL.md:\d+: ERROR: body is \d+ lines, hard cap 300")
case("word_cap", lambda c: append(c, SKILL, "\n" + "word " * 2100 + "\n"), r"SKILL.md:\d+: ERROR: body is \d+ words, hard cap 2000")
case("no_skill_readme", lambda c: write(c, FORMS / "README.md", "x\n"), r"must not contain a README.md")
case("no_skill_scripts", lambda c: write(c, FORMS / "scripts" / "a.sh", "x\n"), r"no scripts/ inside a skill")
case("references_plural", lambda c: write(c, FORMS / "reference" / "x.md", "x\n"), r"'references/' \(plural\)")
case("references_one_level", lambda c: write(c, FORMS / "references" / "sub" / "x.md", "x\n"), r"one level deep")
case(
    "reference_toc",
    lambda c: (write(c, FORMS / "references" / "zz-long.md", "# Long\n" + "line\n" * 150), sub(c, SKILL, r"^## References\n", "## References\n\n- `references/zz-long.md` - long.\n")),
    r"zz-long.md:1: ERROR: reference is 151 lines",
)
case("reference_to_reference_link", lambda c: append(c, first_reference(c), "\nSee [x](other.md).\n"), r"links to another file 'other.md'")
case("cross_skill_reference_link", lambda c: append(c, first_reference(c), "\nSee [x](../../tanstack-query-api/references/mutations.md).\n"), r"links to another file '\.\./\.\./tanstack-query-api")
case("references_index_present", lambda c: sub(c, SKILL, r"^## References$", "## Refs"), r"no '## References' index")
case("references_index_lists_each_file", lambda c: write(c, FORMS / "references" / "zz-unlisted.md", "x\n"), r"has no line for references/zz-unlisted.md")
case(
    "references_index_names_existing_files",
    lambda c: sub(c, SKILL, r"^## References\n", "## References\n\n- `references/does-not-exist.md` - gone.\n"),
    r"names references/does-not-exist.md, which does not exist",
)
case("references_dotfiles_ignored", lambda c: write(c, FORMS / "references" / ".DS_Store", "\0\1binary"), r"DS_Store", present=False)
case("build_output", lambda c: (c / SCAFFOLD / "node_modules").mkdir(), r"build output inside skills/")
case("stray_skill_md_outside_skills", lambda c: write(c, "docs/SKILL.md", "x\n"), r"docs/SKILL.md:1: ERROR: SKILL.md outside skills/<name>/")
case("stray_skill_md_inside_a_skill", lambda c: write(c, FORMS / "assets" / "SKILL.md", "x\n"), r"assets/SKILL.md:1: ERROR: SKILL.md outside skills/<name>/")
case(
    "unknown_skill_directory",
    lambda c: (shutil.copytree(c / FORMS, c / "skills/frontend-extra"), sub(c, "skills/frontend-extra/SKILL.md", r"^name: frontend-forms$", "name: frontend-extra")),
    r"'frontend-extra' is not one of the fourteen",
)
case("missing_skill_strict", lambda c: shutil.rmtree(c / FORMS), r"ERROR: skill 'frontend-forms' from AGENTS.md does not exist yet", "--strict")
case("scope_block_accepted", lambda c: set_scope_block(c, scope_block(c)), r"frontend-forms/SKILL.md:\d+: ERROR: missing the scope block", present=False, baseline_clean=False)
case("scope_block_verbatim", lambda c: set_scope_block(c, scope_block(c).replace("unless asked", "unless told")), r"frontend-forms/SKILL.md:\d+: ERROR: missing the scope block", baseline_clean=False)

# Fences
case("fence_tag_allowed", lambda c: append(c, SKILL, "\n```python\nx = 1\n```\n"), r"fence tag ```python is not in the allowed set")
case("no_jsx_under_ts", lambda c: append(c, SKILL, "\n```ts\nconst a = <div />;\n```\n"), r"JSX under a ```ts fence")
case("unclosed_fence", lambda c: append(c, SKILL, "\n```ts\nconst a = 1;\n"), r"unclosed code fence")
case("indented_ts_fence", lambda c: append(c, first_reference(c), "\n1. Item\n\n   ```tsx,verify\n   export const a = 1;\n   ```\n"), r"frontend-forms/references/[\w.-]+:\d+: ERROR: indented ts or tsx fence: un-indent it")

# Codex metadata
case("openai_yaml_present", lambda c: (c / FORMS / "agents" / "openai.yaml").unlink(), r"missing agents/openai.yaml")
case("openai_yaml_keys", lambda c: sub(c, FORMS / "agents/openai.yaml", r"^\s*display_name:.*\n", ""), r"agents/openai.yaml needs display_name")
case("openai_yaml_short_description", lambda c: sub(c, FORMS / "agents/openai.yaml", r"(short_description:\s*).*", r'\1"' + "x" * 40 + '"'), r"short_description is 40 chars, max 30")

# Eval files
case("eval_file_warn", lambda c: (c / EVAL).unlink(), r"WARN: missing evaluation scenarios for frontend-forms")
case("eval_file_strict", lambda c: (c / EVAL).unlink(), r"ERROR: missing evaluation scenarios for frontend-forms", "--strict")
case("eval_triggering", lambda c: sub(c, EVAL, r"^### Triggering$", "### Trigger"), r"missing '### Triggering' heading")
case("eval_should_load_count", lambda c: sub(c, EVAL, r"^(\*\*Should load\*\*\n\n)(?:\d+\. .*\n)+", r"\g<1>1. One prompt.\n"), r"'\*\*Should load\*\*' needs at least five")
case("eval_should_not_load_winner", lambda c: sub(c, EVAL, r" -> `[a-z0-9-]+`", ""), r"should-not-load prompt must end with")
case("eval_winner_known", lambda c: sub(c, EVAL, r" -> `[a-z0-9-]+`", " -> `nobody-owns-this`"), r"winner 'nobody-owns-this' must be a sibling skill")
case("eval_three_evals", lambda c: sub(c, EVAL, r"^### Eval (\d+) - ", r"### Evalx \1 - ", count=0), r"needs at least three '### Eval N")
case("eval_labels", lambda c: sub(c, EVAL, r"^\*\*Must produce\*\*:", "**Must give**:"), r"Eval 1 is missing the '\*\*Must produce\*\*:' line")
case("probe_wrong_answer", lambda c: sub(c, EVAL, r"^\*\*Wrong answer\*\*: .*$", "**Wrong answer**: none"), r"Probe \d+ needs a '\*\*Wrong answer\*\*")
case("eval_fixture", lambda c: sub(c, EVAL, r"^(### Probe 1 - .*)$", r"\1\n\n**Fixture**: bogus"), r"\*\*Fixture\*\* must be one of")

# Repository plumbing and out-of-stack terms
case("plumbing_stack_md", lambda c: append(c, SKILL, "\nSee STACK.md.\n"), r"SKILL.md:\d+: ERROR: skill text must not mention repository plumbing \(STACK.md\)")
case("plumbing_make_target", lambda c: append(c, SKILL, "\nRun make check.\n"), r"repository plumbing \(repository make target\)")
case("plumbing_evals_dir", lambda c: append(c, SKILL, "\nSee evals/x.\n"), r"repository plumbing \(evals/\)")
case("plumbing_in_reference", lambda c: append(c, first_reference(c), "\nSee STACK.md.\n"), r"references/[\w.-]+:\d+: ERROR: skill text must not mention repository plumbing")
case("plumbing_in_template_agents_md", lambda c: append(c, SCAFFOLD / "AGENTS.md", "\nSee STACK.md and run make check.\n"), S(SCAFFOLD / "AGENTS.md") + r":\d+: ERROR: skill text must not mention repository plumbing")
case("out_of_stack_in_template_readme", lambda c: append(c, SCAFFOLD / "README.md", "\nRun npx foo.\n"), S(SCAFFOLD / "README.md") + r":\d+: ERROR: out-of-stack term 'npx'")
case("out_of_stack_nextjs", lambda c: append(c, SKILL, "\nUse Next.js here.\n"), r"out-of-stack term 'Next.js' \(Next.js\)")
case("out_of_stack_npx", lambda c: append(c, SKILL, "\nRun npx foo.\n"), r"out-of-stack term 'npx' \(npm command\)")
case("out_of_stack_npm_bootstrap_allowed", lambda c: append(c, SKILL, "\nRun `npm install --global pnpm@12.0.0` first.\n"), r"\(npm command\)", present=False)
case("out_of_stack_yarn", lambda c: append(c, SKILL, "\nRun yarn add foo.\n"), r"out-of-stack term 'yarn' \(yarn\)")
case("out_of_stack_rejected_library", lambda c: append(c, SKILL, f"\nInstall {rejected_name(c)} for this.\n"), r"\(rejected in STACK.md\)")
case("out_of_stack_common_word_prose_allowed", lambda c: append(c, SKILL, "\nA turbo build is not needed.\n"), r"out-of-stack term 'turbo'", present=False)
case("out_of_stack_common_word_as_code", lambda c: append(c, SKILL, "\nRun `turbo` here.\n"), r"out-of-stack term 'turbo' \(rejected in STACK.md\)")
case("out_of_stack_prose_under_red_flags", lambda c: sub(c, SKILL, r"^(## Red Flags.*)$", r"\1\n\nUse ESLint instead.\n"), r"out-of-stack term 'ESLint'")
case("out_of_stack_corrections_heading_not_exempt", lambda c: append(c, SKILL, "\n## Corrections\n\n| ESLint config | Biome |\n"), r"out-of-stack term 'ESLint'")
case("out_of_stack_red_flags_row_allowed", lambda c: append(c, SKILL, "\n| ESLint config | Biome |\n"), r"out-of-stack term 'ESLint'", present=False)
case("out_of_stack_in_ts_fragment", lambda c: append(c, SKILL, "\n```ts\nimport useSWR from 'swr';\n```\n"), r"\(SWR\)")
case("out_of_stack_ignore_fence_allowed", lambda c: append(c, SKILL, "\n```ts,ignore\nimport useSWR from 'swr';\n```\n"), r"\(SWR\)", present=False)

# Manifests and STACK.md
case("manifest_versions_equal", lambda c: sub(c, ".cursor-plugin/plugin.json", r'"version": "[^"]+"', '"version": "9.9.9"'), r"manifest versions disagree")
case(
    "marketplace_metadata_version",
    lambda c: write(c, ".claude-plugin/marketplace.json", json.dumps({**(m := json.loads(read(c, ".claude-plugin/marketplace.json"))), "metadata": {**m.get("metadata", {}), "version": "9.9.9"}}, indent=2) + "\n"),
    r"manifest versions disagree",
)
case(
    "codex_short_description",
    lambda c: write(c, ".codex-plugin/plugin.json", json.dumps({**(m := json.loads(read(c, ".codex-plugin/plugin.json"))), "interface": {**m["interface"], "shortDescription": "x" * 40}}, indent=2) + "\n"),
    r"interface.shortDescription is 40 chars",
)
case("stack_parity_dependencies", lambda c: sub(c, SCAFFOLD / "package.json", r'("zod": ")[^"]+"', r'\g<1>0.0.1"'), r"package.json:1: ERROR: dependencies differs from STACK.md: zod")
case("stack_parity_dev_engines", lambda c: sub(c, SCAFFOLD / "package.json", r'("runtime": \{\s*"name": "node",\s*"version": ")[^"]+"', r'\g<1>0.0.1"'), r"devEngines differs from STACK.md")
case("addon_exact_version", lambda c: sub(c, "STACK.md", r'("keycloak-js": ")([^"]+)"', r'\1^\2"'), r"add-on keycloak-js: \"\^[\d.]+\" is not an exact version")
case("addon_not_in_baseline", lambda c: sub(c, "STACK.md", r'("keycloak-js": "[^"]+",)', r'\1\n    "zod": "4.0.0",'), r"add-on zod is already in the '## package.json' block")

# Copies of pinned versions under skills/
STALE = r"{file}:{line}: ERROR: stale version: {name} 0\.0\.1, but STACK.md pins \d"


def stale(name: str, line: str = r"\d+") -> str:
    return STALE.format(file=r"references/[\w.-]+\.md", line=line, name=re.escape(name))


case("pin_copy_json", lambda c: append(c, first_reference(c), '\n```json\n{ "msw": "0.0.1" }\n```\n'), stale("msw"))
case("pin_copy_yaml_catalog", lambda c: append(c, first_reference(c), "\n```yaml\ncatalog:\n  msw: 0.0.1\n  '@tanstack/react-query': 0.0.1\n```\n"), stale("msw") + "|" + stale("@tanstack/react-query"))
case("pin_copy_at_version", lambda c: append(c, first_reference(c), "\nRun `pnpm add @tanstack/react-query@0.0.1`.\n"), stale("@tanstack/react-query"))
case("pin_copy_prose", lambda c: append(c, first_reference(c), "\nMeasured with MSW 0.0.1.\n"), stale("msw"))
case("pin_copy_pnpm_bootstrap", lambda c: append(c, first_reference(c), "\n```dockerfile\nRUN npm install --global pnpm@0.0.1\n```\n"), stale("pnpm"))
case("pin_copy_pnpm_variable", lambda c: append(c, first_reference(c), "\n```yaml\nvariables:\n  PNPM_VERSION: 0.0.1\n```\n"), stale("pnpm"))
case("pin_copy_node_image", lambda c: append(c, first_reference(c), "\n```yaml\nimage: node:0.0.1-trixie-slim\n```\n"), stale("node"))
case("pin_copy_digest_comment", lambda c: append(c, first_reference(c), "\n```yaml\nimage: mcr.microsoft.com/playwright@sha256:" + "a" * 64 + " # v0.0.1-noble\n```\n"), stale("playwright"))
case("pin_copy_playwright_image", lambda c: append(c, first_reference(c), "\n```yaml\nimage: mcr.microsoft.com/playwright:v0.0.1-noble\n```\n"), stale("playwright"))
case(
    "pin_copy_dev_engines",
    lambda c: append(c, first_reference(c), '\n```json\n{\n  "packageManager": {\n    "name": "pnpm",\n    "version": "0.0.1"\n  }\n}\n```\n'),
    stale("pnpm"),
)
case(
    "pin_copy_bare_engine_version",
    lambda c: append(c, first_reference(c), f"\nAfter the install pnpm switches to {pin(c, 'pnpm').split('.')[0]}.0.1.\n"),
    r"references/[\w.-]+\.md:\d+: ERROR: stale version: pnpm \d+\.0\.1, but STACK.md pins",
)
case("pin_copy_table_cell", lambda c: append(c, first_reference(c), "\n| `msw` | 0.0.1 |\n"), stale("msw"))
case("pin_copy_display_name", lambda c: append(c, first_reference(c), "\nMeasured on TanStack Query 0.0.1.\n"), stale("@tanstack/react-query"))
case("pin_copy_caret_range", lambda c: append(c, first_reference(c), '\n```json\n{ "msw": "^0.0.1" }\n```\n'), stale("msw"))
case("pin_copy_yaml_name_version", lambda c: append(c, first_reference(c), "\n```yaml\n- name: msw\n  version: 0.0.1\n```\n"), stale("msw"))
case("pin_copy_line_break", lambda c: append(c, first_reference(c), "\nThe handlers were measured with MSW\n0.0.1 on a laptop.\n"), stale("msw"))
case("pin_copy_split_json", lambda c: append(c, first_reference(c), '\n```json\n{\n  "msw":\n    "0.0.1"\n}\n```\n'), stale("msw"))
case("pin_copy_service_image", lambda c: append(c, first_reference(c), "\n```yaml\nimage: quay.io/keycloak/keycloak:0.0.1\n```\n"), stale("keycloak"))
case(
    "pin_copy_bare_engine_version_wrapped",
    lambda c: append(c, first_reference(c), f"\nAfter the install pnpm switches\nto {pin(c, 'pnpm').split('.')[0]}.0.1.\n"),
    r"references/[\w.-]+\.md:\d+: ERROR: stale version: pnpm \d+\.0\.1, but STACK.md pins",
)
case(
    "pin_copy_other_product_near_node_allowed",
    lambda c: append(c, first_reference(c), f"\nThe token's DOM node is replaced.\nKeycloak server {pin(c, 'node').split('.')[0]}.4.0 issues it.\n"),
    r"stale version: node",
    present=False,
)
case(
    "pin_copy_other_product_after_pnpm_sentence_allowed",
    lambda c: append(c, first_reference(c), f"\nInstall it with pnpm. Chrome {pin(c, 'pnpm').split('.')[0]}.0.1 renders it.\n"),
    r"stale version: pnpm",
    present=False,
)
case(
    "pin_copy_malformed_stack_json",
    lambda c: sub(c, "STACK.md", r'("dependencies": \{)', r"\1,"),
    r"STACK\.md:\d+: ERROR: the '## package.json' block is not valid JSON",
)
case("pin_copy_prior_version_first_cell_allowed", lambda c: append(c, first_reference(c), "\n## Prior-version notes\n\n| `msw@0.0.1` | current |\n"), r"stale version: msw 0\.0\.1", present=False)
case("pin_copy_prior_version_current_cell", lambda c: append(c, first_reference(c), "\n## Prior-version notes\n\n| old | `msw@0.0.1` |\n"), stale("msw"))
case("pin_copy_equal_to_pin_allowed", lambda c: append(c, first_reference(c), f'\n```json\n{{ "msw": "{pin(c, "msw")}" }}\n```\n'), r"frontend-forms/references/[\w.-]+:\d+: ERROR: stale version: msw", present=False)


def bump_pin_by_the_book(c: Path) -> None:
    """H1 finding 1: the pin moves in STACK.md and the scaffold, every other copy is left behind."""
    old = pin(c, "msw")
    for rel in ("STACK.md", SCAFFOLD / "package.json"):
        sub(c, rel, rf'"msw": "{re.escape(old)}"', '"msw": "99.0.0"')


case("pin_bump_lists_stale_copies", bump_pin_by_the_book, r"skills/(?!frontend-scaffolding/assets/app/package\.json)\S+:\d+: ERROR: stale version: msw [\d.]+, but STACK.md pins 99\.0\.0")

# --base
case("base_unknown_ref", lambda c: None, r"git diff against 'no-such-ref' failed", "--base", "no-such-ref", git=True, baseline_clean=False)
case("base_skill_changed_without_bump", lambda c: append(c, SKILL, "\nOne more line.\n"), r"skills/frontend-forms/ changed since base but metadata.version is still", "--base", "base", git=True)
case("base_plugin_version_not_bumped", lambda c: append(c, SKILL, "\nOne more line.\n"), r"skills/ changed since base but the plugin version did not", "--base", "base", git=True)
case(
    "base_version_reindented",
    lambda c: (append(c, SKILL, "\nOne more line.\n"), sub(c, SKILL, r"^  version: ", "    version: ")),
    r"metadata.version is still",
    "--base",
    "base",
    git=True,
)
case(
    "base_bumped_passes",
    lambda c: (append(c, SKILL, "\nOne more line.\n"), sub(c, SKILL, r'^(\s+version: )"[^"]+"', rf'\1"{bump(skill_version(c))}"'), set_versions(c, "99.0.0")),
    r"since base",
    "--base",
    "base",
    git=True,
    present=False,
)
case(
    "base_skill_version_backwards",
    lambda c: (append(c, SKILL, "\nOne more line.\n"), sub(c, SKILL, r'^(\s+version: )"[^"]+"', r'\1"0.0.0"'), set_versions(c, "99.0.0")),
    r"metadata.version moved backwards since base",
    "--base",
    "base",
    git=True,
)
case("base_plugin_version_backwards", lambda c: set_versions(c, "0.0.0"), r"the plugin version moved backwards since base", "--base", "base", git=True)


# --------------------------------------------------------------------------- runner


def run_validator(copy: Path, *args: str) -> str:
    result = subprocess.run([sys.executable, "-B", "scripts/validate_skills.py", *args], cwd=copy, capture_output=True, text=True, timeout=120)
    return result.stdout + result.stderr


def git_init(copy: Path) -> None:
    for args in (["init", "-q"], ["add", "-A"], ["commit", "-q", "--no-verify", "-m", "base"], ["tag", "base"]):
        subprocess.run(GIT + args, cwd=copy, check=True, capture_output=True)


def run_case(pristine: Path, work: Path, index: int, item: Case) -> None:
    copy = work / f"{index:03}-{item.name}"
    shutil.copytree(pristine, copy, symlinks=True)
    if item.git:
        git_init(copy)
    try:
        item.seed(copy)
    except Exception as exc:  # reported by the test, not the pool
        item.output = f"SEED FAILED: {exc!r}"
        return
    item.output = run_validator(copy, *item.args)
    shutil.rmtree(copy)


class ValidatorChecks(unittest.TestCase):
    work: Path

    @classmethod
    def setUpClass(cls) -> None:
        cls.work = Path(tempfile.mkdtemp(prefix="validate-skills-test-"))
        pristine = cls.work / "pristine"
        shutil.copytree(ROOT, pristine, ignore=COPY_IGNORE, symlinks=True)
        with ThreadPoolExecutor(max_workers=min(16, (os.cpu_count() or 2) * 2)) as pool:
            # The unseeded output depends only on the arguments; --base needs a commit to diff against.
            based = cls.work / "pristine-git"
            shutil.copytree(pristine, based, symlinks=True)
            git_init(based)
            keys = {(item.git, item.args) for item in CASES}
            baselines = dict(zip(keys, pool.map(lambda key: run_validator(based if key[0] else pristine, *key[1]), keys)))
            for item in CASES:
                item.baseline = baselines[(item.git, item.args)]
            for future in [pool.submit(run_case, pristine, cls.work, i, item) for i, item in enumerate(CASES)]:
                future.result()

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.work, ignore_errors=True)


def make_test(item: Case) -> Callable[[ValidatorChecks], None]:
    def test(self: ValidatorChecks) -> None:
        self.assertNotIn("SEED FAILED", item.output, item.output)
        self.assertNotIn("Traceback", item.output, item.output)
        if item.baseline_clean:
            self.assertIsNone(re.search(item.expect, item.baseline), f"already in the unseeded output:\n{item.baseline}")
        found = re.search(item.expect, item.output)
        if item.present:
            self.assertIsNotNone(found, f"expected /{item.expect}/ in:\n{item.output}")
        else:
            self.assertIsNone(found, f"unexpected /{item.expect}/ in:\n{item.output}")

    return test


for _item in CASES:
    setattr(ValidatorChecks, f"test_{_item.name}", make_test(_item))


class BuildEvalCasesGuard(unittest.TestCase):
    """build_eval_cases.py --out deletes its output directory: only one it generated itself."""

    def setUp(self) -> None:
        self.work = Path(tempfile.mkdtemp(prefix="build-eval-cases-test-"))
        self.repo = self.work / "repo"
        shutil.copytree(ROOT, self.repo, ignore=COPY_IGNORE, symlinks=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.work, ignore_errors=True)

    def build(self, out: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, "-B", "scripts/build_eval_cases.py", "--out", str(out)], cwd=self.repo, capture_output=True, text=True, timeout=120)

    def test_refuses_a_foreign_directory(self) -> None:
        victim = self.work / "victim"
        victim.mkdir()
        (victim / "precious.txt").write_text("precious\n")
        result = self.build(victim)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("was not generated by this script", result.stderr)
        self.assertEqual((victim / "precious.txt").read_text(), "precious\n")

    def test_refuses_the_repository_and_its_ancestors(self) -> None:
        for out in (self.repo, self.work):
            result = self.build(out)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("the repository or one of its ancestors", result.stderr)
        self.assertTrue((self.repo / "AGENTS.md").is_file())

    def test_regenerates_its_own_directory(self) -> None:
        out = self.work / "run"
        first = self.build(out)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertTrue((out / ".generated-by-build-eval-cases").is_file())
        (out / "cases" / "results").mkdir()
        (out / "cases" / "results" / "kept.json").write_text("{}\n")
        (out / "stale.txt").write_text("stale\n")
        second = self.build(out)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertFalse((out / "stale.txt").exists())
        self.assertTrue((out / "cases" / "results" / "kept.json").is_file())

    def test_empty_directory_is_accepted(self) -> None:
        out = self.work / "empty"
        out.mkdir()
        result = self.build(out)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
