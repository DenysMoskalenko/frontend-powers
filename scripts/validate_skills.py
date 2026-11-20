#!/usr/bin/env python3
"""Validate every skills/*/SKILL.md against the frontend-powers house rules (AGENTS.md).

Stdlib only, Python 3.11+. Prints `file:line: LEVEL: message`.
Exit 1 if any ERROR was found; warnings alone exit 0.

Usage:
    python3 scripts/validate_skills.py [--json] [--strict] [--base REF]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"
STACK = ROOT / "STACK.md"
EVALS = ROOT / "evals"
SCAFFOLD_SKILL = "frontend-scaffolding"
SCAFFOLD_PACKAGE = SKILLS / SCAFFOLD_SKILL / "assets" / "app" / "package.json"
PINNED_PACKAGE_KEYS = ("dependencies", "devDependencies", "devEngines")
ADDON_KEYS = ("dependencies", "devDependencies")
EXACT_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
# Rejected names that are also ordinary English words count only as code: backticked, quoted, or `name.js`.
COMMON_WORD_NAMES = {"moment"}

EXPECTED_SKILLS = {
    "frontend-code-style",
    "frontend-project-structure",
    "tanstack-router-spa",
    "tanstack-query-api",
    "frontend-forms",
    "tailwind-base-ui",
    "frontend-testing",
    "frontend-tooling",
    "frontend-deploy",
    "frontend-scaffolding",
    "keycloak-spa-auth",
    "frontend-i18n",
    "frontend-realtime",
    "frontend-shared-packages",
}
# Should-not-load prompts may name one of these as the winner (AGENTS.md "Third-Party Skills").
THIRD_PARTY_SKILLS = {
    "vercel-react-best-practices",
    "vercel-composition-patterns",
    "web-design-guidelines",
    "frontend-design",
    "emil-design-eng",
    "pick-ui-library",
    "ask-sonner",
    "animate",
    "review-animations",
    "apple-design",
    "mobile-native",
    "modern-web-guidance",
    "writing-good-tests",
}

SCOPE_BLOCK = (
    "Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the "
    "frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say "
    "so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing "
    "code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, "
    "unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins "
    "another major version than the line above, follow the project and say which rules may not apply."
)

ALLOWED_KEYS = {"name", "description", "metadata"}
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
RESERVED_IN_NAME = ("claude", "anthropic")
FORBIDDEN_IN_FRONTMATTER = "<>#"
DESCRIPTION_PREFIX = "Use when "
DESCRIPTION_MAX_WORDS = 75
DESCRIPTIONS_MAX_CHARS = 8000
SHORT_DESCRIPTION_MAX = 30

# Body budgets: (warn, error)
LINE_BUDGET = (250, 300)
WORD_BUDGET = (1500, 2000)

TS_TAGS = {"ts", "ts,verify", "ts,verify,test", "ts,ignore"}
TSX_TAGS = {"tsx", "tsx,verify", "tsx,verify,test", "tsx,ignore"}
IGNORE_TAGS = {"ts,ignore", "tsx,ignore"}
ALLOWED_FENCES = TS_TAGS | TSX_TAGS | {
    "",
    "js",
    "json",
    "jsonc",
    "yaml",
    "toml",
    "ini",
    "css",
    "html",
    "dockerfile",
    "caddyfile",
    "bash",
    "sh",
    "console",
    "text",
    "diff",
    "env",
    "markdown",
    "mermaid",
}
JSX_RE = re.compile(r"</[A-Za-z>]|/>")

# Repository plumbing must not leak into skill text. No exemptions: a skill is read inside somebody
# else's project, where none of these exist. Lookbehinds keep `src/tmp/` and `/tmp/` legal.
REPO_PLUMBING = [
    (re.compile(r"\bSTACK\.md\b"), "STACK.md"),
    (re.compile(r"(?<![\w/.$-])evals/"), "evals/"),
    (re.compile(r"(?<![\w/.$-])tmp/"), "tmp/"),
    (re.compile(r"(?<![\w/.$-])maintenance/"), "maintenance/"),
    (re.compile(r"\b(?:validate_skills|check_snippets|build_eval_cases|summarize_evals)(?:\.py)?\b"), "repository script"),
    (re.compile(r"\bmake (?:check|validate|snippets|evals|lint)\b"), "repository make target"),
    (re.compile(r"__verify__|frontend-powers-verify|generated-by-check-snippets|\bverify (?:copy|dir)\b", re.IGNORECASE), "snippet verify copy"),
]

# Out-of-stack terms (AGENTS.md "Out-of-stack terms"). Case-sensitive where the lowercase word is
# legitimate: `stale-while-revalidate`, `@testing-library/jest-dom`, a global `jest` timer shim.
OUT_OF_STACK = [
    (re.compile(r"\bnext\.?js\b|\bnext\.config\b|\bgetServerSideProps\b|\bgetStaticProps\b|\bnext/(?:router|navigation|link|image|headers)\b", re.IGNORECASE), "Next.js"),
    (re.compile(r"\bSSR\b|(?i:server[- ]side render)"), "SSR"),
    (re.compile(r"(?i:\bserver components?\b)|\bRSC\b|[\"']use (?:server|client)[\"']"), "server components"),
    (re.compile(r"\bSWR\b|\buseSWR\b|[\"']swr[\"']"), "SWR"),
    (re.compile(r"\beslint", re.IGNORECASE), "ESLint"),
    (re.compile(r"\bprettier", re.IGNORECASE), "Prettier"),
    (re.compile(r"\bJest\b|\bjest\.(?!advanceTimersByTime\b)\w+|@jest/|\b(?:ts|babel)-jest\b|\bjest-environment|\bjest\s+--|\b(?:pnpm|npx|yarn|npm)\s+(?:exec\s+|run\s+)?jest\b|:\s*[\"']jest\b"), "Jest"),
    # The pnpm bootstrap `npm install --global pnpm@<version>` is the one npm command a skill may show.
    (re.compile(r"\bnpm\s+(?!install\s+(?:--global|-g)\s+pnpm@(?:\d[\w.-]*|\$\{?\w+\}?)(?=\s*(?:$|[`&;|)\"'#])))(?:install|i|ci|run|run-script|exec|x|add|uninstall|remove|rm|update|up|init|create|test|start|publish|link)\b|\bnpx\b"), "npm command"),
    (re.compile(r"\byarn\b", re.IGNORECASE), "yarn"),
]
# Table rows under these headings may name out-of-stack terms: Red Flags, prior-version corrections,
# and the third-party precedence table.
EXEMPT_HEADING_RE = re.compile(r"red flags|prior[- ]version|corrections?\b|precedence", re.IGNORECASE)

# A markdown link to a .md file other than SKILL.md.
MD_LINK_RE = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")

# evals/<skill>.md structure (see evals/README.md).
EVAL_TRIGGERING_RE = re.compile(r"^### Triggering\s*$", re.MULTILINE)
EVAL_SHOULD_LOAD_RE = re.compile(r"^\*\*Should load\*\*\s*$", re.MULTILINE)
EVAL_SHOULD_NOT_LOAD_RE = re.compile(r"^\*\*Should not load\*\*\s*$", re.MULTILINE)
EVAL_HEADING_RE = re.compile(r"^### Eval (\d+) - \S", re.MULTILINE)
EVAL_NUMBERED_RE = re.compile(r"^\d+\. \S")
EVAL_WINNER_RE = re.compile(r"-> `([a-z0-9-]+)`")
PROBE_SPLIT_RE = re.compile(r"^### Probe \d+ - .*$", re.MULTILINE)
FIXTURE_RE = re.compile(r"^\*\*Fixture\*\*:(.*)$", re.MULTILINE)
WRONG_ANSWER_RE = re.compile(r"^\*\*Wrong answer\*\*: `.+`\s*$", re.MULTILINE)
FIXTURES = {"scaffold", "empty", "backend-repo"}

# Directories that are build output wherever they appear under skills/.
BUILD_OUTPUT = {"node_modules", "dist", "coverage", "test-results", "playwright-report", ".vite", ".wrangler", ".tanstack"}
# Not scanned for stray SKILL.md files: VCS data, installs, and gitignored local work.
SKILL_SCAN_SKIP = {".git", "node_modules", ".run", "tmp"}

# Every manifest carries the same release version; an installed plugin updates only when it changes.
MANIFESTS = (
    (ROOT / ".claude-plugin" / "plugin.json", ("version",)),
    (ROOT / ".claude-plugin" / "marketplace.json", ("version",)),
    (ROOT / ".claude-plugin" / "marketplace.json", ("metadata", "version")),
    (ROOT / ".codex-plugin" / "plugin.json", ("version",)),
    (ROOT / ".cursor-plugin" / "plugin.json", ("version",)),
)


@dataclass
class Finding:
    file: str
    line: int
    level: str
    message: str

    def render(self) -> str:
        return f"{self.file}:{self.line}: {self.level}: {self.message}"


class Report:
    def __init__(self) -> None:
        self.findings: list[Finding] = []

    def add(self, path: Path, line: int, level: str, message: str) -> None:
        try:
            rel = path.relative_to(ROOT)
        except ValueError:
            rel = path
        self.findings.append(Finding(str(rel), line, level, message))

    def error(self, path: Path, line: int, message: str) -> None:
        self.add(path, line, "ERROR", message)

    def warn(self, path: Path, line: int, message: str) -> None:
        self.add(path, line, "WARN", message)

    @property
    def error_count(self) -> int:
        return sum(1 for f in self.findings if f.level == "ERROR")


# --------------------------------------------------------------------------- YAML


def frontmatter_end(lines: list[str]) -> int | None:
    if not lines or lines[0] != "---":
        return None
    return next((i for i, ln in enumerate(lines[1:], start=1) if ln == "---"), None)


def parse_frontmatter(lines: list[str], path: Path, report: Report) -> dict[str, tuple[str, int]]:
    """Tiny YAML subset: `key: value`, quoted scalars, one nested map level.

    Returns {key: (raw_value_text, line_number)}; nested keys are `parent.child`.
    """
    if not lines or lines[0] != "---":
        report.error(path, 1, "missing YAML frontmatter (file must start with ---)")
        return {}
    end = frontmatter_end(lines)
    if end is None:
        report.error(path, 1, "frontmatter is never closed with ---")
        return {}

    out: dict[str, tuple[str, int]] = {}
    current_parent: str | None = None
    for idx in range(1, end):
        lineno = idx + 1
        raw = lines[idx]
        if not raw.strip():
            continue
        bad = sorted({c for c in FORBIDDEN_IN_FRONTMATTER if c in raw})
        if bad:
            report.error(path, lineno, f"frontmatter must not contain {' '.join(repr(c) for c in bad)}")
        if raw[:1].isspace():
            if current_parent is None:
                report.error(path, lineno, f"indented line has no parent key: {raw.strip()!r}")
            elif ":" not in raw:
                report.error(path, lineno, f"unparseable nested frontmatter line: {raw.strip()!r}")
            else:
                child, _, value = raw.strip().partition(":")
                out[f"{current_parent}.{child.strip()}"] = (value.strip(), lineno)
            continue
        if ":" not in raw:
            report.error(path, lineno, f"unparseable frontmatter line: {raw.strip()!r}")
            continue
        key, _, value = raw.partition(":")
        key, value = key.strip(), value.strip()
        if key in out:
            report.error(path, lineno, f"duplicate frontmatter key {key!r}")
        out[key] = (value, lineno)
        current_parent = key if value == "" else None
    return out


def unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def yaml_value(text: str, key: str) -> str | None:
    """The scalar of the first `key:` line at any indentation (enough for agents/openai.yaml)."""
    m = re.search(rf"^\s*{re.escape(key)}:\s*(.*?)\s*$", text, re.MULTILINE)
    return unquote(m.group(1)) if m else None


# --------------------------------------------------------------------------- checks


def check_frontmatter(skill_dir: Path, path: Path, fm: dict[str, tuple[str, int]], report: Report) -> str:
    """Returns the description text ("" if absent)."""
    for key in sorted({key for key in fm if "." not in key} - ALLOWED_KEYS):
        report.error(path, fm[key][1], f"unknown frontmatter key {key!r} (allowed: {', '.join(sorted(ALLOWED_KEYS))})")
    for key in sorted(k for k in fm if "." in k and k != "metadata.version"):
        report.error(path, fm[key][1], f"unknown frontmatter key {key!r} (metadata holds only version)")

    version = fm.get("metadata.version")
    if version is None or not unquote(version[0]):
        report.error(path, fm["metadata"][1] if "metadata" in fm else 1, "frontmatter needs `metadata:` with a `version:` line")
    elif not (version[0].startswith('"') and version[0].endswith('"') and len(version[0]) >= 2):
        report.error(path, version[1], 'metadata.version must be quoted, e.g. version: "0.1.0"')

    if "name" not in fm:
        report.error(path, 1, "frontmatter is missing required key 'name'")
    else:
        raw, lineno = fm["name"]
        name = unquote(raw)
        if not NAME_RE.match(name):
            report.error(path, lineno, f"name {name!r} must match ^[a-z0-9]+(-[a-z0-9]+)*$")
        if len(name) > 64:
            report.error(path, lineno, f"name is {len(name)} chars, max 64")
        if name != skill_dir.name:
            report.error(path, lineno, f"name {name!r} must equal the directory name {skill_dir.name!r}")
        for reserved in RESERVED_IN_NAME:
            if reserved in name.lower():
                report.error(path, lineno, f"name must not contain the reserved word {reserved!r}")

    if "description" not in fm:
        report.error(path, 1, "frontmatter is missing required key 'description'")
        return ""
    raw, lineno = fm["description"]
    if not (len(raw) >= 2 and raw.startswith('"') and raw.endswith('"')):
        report.error(path, lineno, "description must be a double-quoted YAML scalar")
    text = unquote(raw)
    if not 1 <= len(text) <= 1024:
        report.error(path, lineno, f"description is {len(text)} chars, must be 1-1024")
    if not text.startswith(DESCRIPTION_PREFIX):
        report.error(path, lineno, f'description must start with "{DESCRIPTION_PREFIX}"')
    n_words = len(text.split())
    if n_words > DESCRIPTION_MAX_WORDS:
        report.error(path, lineno, f"description is {n_words} words, max {DESCRIPTION_MAX_WORDS}")
    return text


def check_budgets(path: Path, lines: list[str], body_start: int, report: Report) -> None:
    body = lines[body_start:]
    n_lines = len(body)
    n_words = len(" ".join(body).split())
    warn_l, err_l = LINE_BUDGET
    warn_w, err_w = WORD_BUDGET
    if n_lines > err_l:
        report.error(path, body_start + 1, f"body is {n_lines} lines, hard cap {err_l}")
    elif n_lines > warn_l:
        report.warn(path, body_start + 1, f"body is {n_lines} lines, target {warn_l}")
    if n_words > err_w:
        report.error(path, body_start + 1, f"body is {n_words} words, hard cap {err_w}")
    elif n_words > warn_w:
        report.warn(path, body_start + 1, f"body is {n_words} words, target {warn_w}")


def check_scope_block(skill_dir: Path, path: Path, lines: list[str], body_start: int, report: Report) -> None:
    if skill_dir.name == SCAFFOLD_SKILL:
        return
    body = lines[body_start:]
    first_section = next((i for i, ln in enumerate(body) if ln.startswith("## ")), len(body))
    if SCOPE_BLOCK not in (ln.strip() for ln in body[:first_section]):
        report.error(path, body_start + 1, "missing the scope block (AGENTS.md 'Scope block'), verbatim on one line after the version pin and before the first ## section")


def check_text(path: Path, lines: list[str], report: Report) -> None:
    """Fence tags, JSX under a ts tag, repository plumbing, and out-of-stack terms, in one pass."""
    tag: str | None = None
    exempt_table = False
    for idx, raw in enumerate(lines, start=1):
        if raw.startswith("```"):
            if tag is None:
                tag = raw[3:].strip()
                if tag not in ALLOWED_FENCES:
                    report.error(path, idx, f"fence tag ```{tag} is not in the allowed set")
            else:
                tag = None
            continue
        if tag is None and raw.startswith("#"):
            exempt_table = bool(EXEMPT_HEADING_RE.search(raw))
        for pattern, label in REPO_PLUMBING:
            if pattern.search(raw):
                report.error(path, idx, f"skill text must not mention repository plumbing ({label})")
        if tag in TS_TAGS and tag not in IGNORE_TAGS and JSX_RE.search(raw):
            report.error(path, idx, f"JSX under a ```{tag} fence; use the tsx tag")
        if tag in IGNORE_TAGS or (tag is None and exempt_table and raw.lstrip().startswith("|")):
            continue
        for pattern, label in OUT_OF_STACK:
            if m := pattern.search(raw):
                report.error(path, idx, f"out-of-stack term {m.group(0)!r} ({label}); allowed only in a Red Flags row, a prior-version table, the precedence table, or an ignore fence")
    if tag is not None:
        report.error(path, len(lines), "unclosed code fence")


def check_reference_links(path: Path, lines: list[str], report: Report) -> None:
    """A references/*.md may link to SKILL.md or to itself; never to another reference."""
    for idx, raw in enumerate(lines, start=1):
        for target in MD_LINK_RE.findall(raw):
            if "://" in target or target.endswith("SKILL.md"):
                continue
            if target.endswith(".md"):
                report.error(path, idx, f"reference links to another file {target!r}; SKILL.md is the only index")


def check_references(skill_dir: Path, skill_md: Path, body: str, report: Report) -> None:
    refs = skill_dir / "references"
    if not refs.is_dir():
        return
    if not re.search(r"^## References\s*$", body, re.MULTILINE):
        report.error(skill_md, 1, "references/ exists but SKILL.md has no '## References' index")
    for item in sorted(refs.rglob("*")):
        rel = item.relative_to(refs)
        if len(rel.parts) > 1:
            report.error(item, 1, f"references/ must be one level deep, found {rel.as_posix()!r}")
            continue
        if item.is_dir():
            report.error(item, 1, f"references/ must contain files only, found directory {rel.as_posix()!r}")
            continue
        if f"references/{item.name}" not in body:
            report.error(skill_md, 1, f"## References has no line for references/{item.name}")
        if item.suffix != ".md":
            continue
        lines = item.read_text(encoding="utf-8").splitlines()
        check_text(item, lines, report)
        check_reference_links(item, lines, report)
        if len(lines) <= 100:
            continue
        head = lines[:20]
        has_heading = any(ln.startswith("#") and re.search(r"contents|toc", ln, re.IGNORECASE) for ln in head)
        link_list = sum(1 for ln in head if re.match(r"^\s*[-*] \[[^\]]+\]\(#[^)]+\)", ln))
        if not has_heading and link_list < 3:
            report.error(item, 1, f"reference is {len(lines)} lines (>100) and needs a TOC in the first 20 lines (a Contents heading or a list of anchor links)")


def check_openai_yaml(skill_dir: Path, report: Report) -> None:
    path = skill_dir / "agents" / "openai.yaml"
    if not path.is_file():
        report.error(path, 1, "missing agents/openai.yaml (Codex per-skill metadata)")
        return
    text = path.read_text(encoding="utf-8")
    for key in ("display_name", "short_description", "allow_implicit_invocation"):
        if not yaml_value(text, key):
            report.error(path, 1, f"agents/openai.yaml needs {key}")
    short = yaml_value(text, "short_description")
    if short and len(short) > SHORT_DESCRIPTION_MAX:
        report.error(path, 1, f"short_description is {len(short)} chars, max {SHORT_DESCRIPTION_MAX}")


def check_eval_file(path: Path, skill: str, report: Report) -> None:
    """The exact format in evals/README.md, so ownership tests are machine-checkable."""
    text = path.read_text(encoding="utf-8")
    if not EVAL_TRIGGERING_RE.search(text):
        report.error(path, 1, "missing '### Triggering' heading")
        return
    lines = text.splitlines()

    def numbered_after(marker: re.Pattern[str]) -> list[tuple[int, str]]:
        m = marker.search(text)
        if m is None:
            return []
        start = text[: m.start()].count("\n") + 1
        items: list[tuple[int, str]] = []
        for lineno in range(start + 1, len(lines) + 1):
            ln = lines[lineno - 1]
            if ln.startswith("#") or ln.startswith("**"):
                break
            if EVAL_NUMBERED_RE.match(ln):
                items.append((lineno, ln))
        return items

    if not EVAL_SHOULD_LOAD_RE.search(text):
        report.error(path, 1, "missing '**Should load**' block")
    elif len(numbered_after(EVAL_SHOULD_LOAD_RE)) < 5:
        report.error(path, 1, "'**Should load**' needs at least five numbered prompts")
    if not EVAL_SHOULD_NOT_LOAD_RE.search(text):
        report.error(path, 1, "missing '**Should not load**' block")
    else:
        items = numbered_after(EVAL_SHOULD_NOT_LOAD_RE)
        if len(items) < 5:
            report.error(path, 1, "'**Should not load**' needs at least five numbered prompts")
        for lineno, ln in items:
            m = EVAL_WINNER_RE.search(ln)
            if not m:
                report.error(path, lineno, "should-not-load prompt must end with '-> `<skill-that-should-win>`'")
            elif m.group(1) == skill or m.group(1) not in EXPECTED_SKILLS | THIRD_PARTY_SKILLS:
                report.error(path, lineno, f"winner {m.group(1)!r} must be a sibling skill or a third-party skill from AGENTS.md")

    evals = EVAL_HEADING_RE.findall(text)
    if len(evals) < 3:
        report.error(path, 1, f"needs at least three '### Eval N - <name>' blocks, found {len(evals)}")
    eval_part = PROBE_SPLIT_RE.split(text)[0]
    for n, section in enumerate(re.split(r"^### Eval \d+ - .*$", eval_part, flags=re.MULTILINE)[1:], start=1):
        for label in ("**Prompt**:", "**Must produce**:", "**Must not produce**:"):
            if label not in section:
                report.error(path, 1, f"Eval {n} is missing the {label!r} line")
    for n, section in enumerate(PROBE_SPLIT_RE.split(text)[1:], start=1):
        if "**Prompt**:" not in section:
            report.error(path, 1, f"Probe {n} is missing the '**Prompt**:' line")
        if not WRONG_ANSWER_RE.search(section):
            report.error(path, 1, f"Probe {n} needs a '**Wrong answer**: `<regex>`' line")
    for m in FIXTURE_RE.finditer(text):
        if m.group(1).strip() not in FIXTURES:
            report.error(path, text[: m.start()].count("\n") + 1, f"**Fixture** must be one of {sorted(FIXTURES)}")


def validate_skill(skill_dir: Path, report: Report, strict: bool) -> str:
    """Returns the skill's description text."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        report.error(skill_dir, 1, "skill directory has no SKILL.md")
        return ""
    if skill_dir.name not in EXPECTED_SKILLS:
        report.error(skill_dir, 1, f"{skill_dir.name!r} is not one of the fourteen skills listed in AGENTS.md")

    lines = skill_md.read_text(encoding="utf-8").splitlines()
    fm = parse_frontmatter(lines, skill_md, report)
    description = check_frontmatter(skill_dir, skill_md, fm, report)
    end = frontmatter_end(lines)
    body_start = end + 1 if end is not None else 0

    check_budgets(skill_md, lines, body_start, report)
    check_scope_block(skill_dir, skill_md, lines, body_start, report)
    check_text(skill_md, lines, report)
    check_references(skill_dir, skill_md, "\n".join(lines[body_start:]), report)
    check_openai_yaml(skill_dir, report)

    if (skill_dir / "README.md").exists():
        report.error(skill_dir / "README.md", 1, "a skill directory must not contain a README.md")
    if (skill_dir / "scripts").exists():
        report.error(skill_dir / "scripts", 1, "skills ship instructions, not scripts: no scripts/ inside a skill")
    if (skill_dir / "reference").is_dir():
        report.error(skill_dir / "reference", 1, "supporting material goes in 'references/' (plural), not 'reference/'")
    for dirpath, dirnames, _ in os.walk(skill_dir):
        for name in sorted(BUILD_OUTPUT & set(dirnames)):
            dirnames.remove(name)
            report.error(Path(dirpath) / name, 1, "build output inside skills/: local plugin installs copy it; delete it")

    eval_file = EVALS / f"{skill_dir.name}.md"
    if not eval_file.is_file():
        level = report.error if strict else report.warn
        level(eval_file, 1, f"missing evaluation scenarios for {skill_dir.name} (see evals/README.md)")
    else:
        check_eval_file(eval_file, skill_dir.name, report)
    return description


def check_stray_skill_files(report: Report) -> None:
    """`npx skills add` and Cursor discover a SKILL.md anywhere, so only skills/<name>/SKILL.md may exist."""
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKILL_SCAN_SKIP]
        path = Path(dirpath) / "SKILL.md"
        if "SKILL.md" in filenames and path.parent.parent != SKILLS:
            report.error(path, 1, "SKILL.md outside skills/<name>/ is discovered and installed as a skill; remove or rename it")


# --------------------------------------------------------------------------- STACK.md parity


def fenced_block_after(path: Path, heading_re: str) -> tuple[str, int] | None:
    """The first fenced block after a heading: (text, line of its first content line)."""
    lines = path.read_text(encoding="utf-8").splitlines()
    start = next((i for i, ln in enumerate(lines) if re.match(heading_re, ln)), None)
    if start is None:
        return None
    open_idx = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("```")), None)
    if open_idx is None:
        return None
    close_idx = next((i for i in range(open_idx + 1, len(lines)) if lines[i].startswith("```")), None)
    if close_idx is None:
        return None
    return "\n".join(lines[open_idx + 1 : close_idx]), open_idx + 2


def check_package_parity(report: Report) -> None:
    if not STACK.is_file():
        report.error(STACK, 1, "STACK.md is missing; it is the source of truth the scaffold package.json is checked against")
        return
    block = fenced_block_after(STACK, r"^##\s+package\.json\s*$")
    if block is None:
        report.error(STACK, 1, "no fenced JSON block under '## package.json'")
        return
    text, line0 = block
    try:
        want = json.loads(text)
    except json.JSONDecodeError as exc:
        report.error(STACK, line0 + exc.lineno - 1, f"the '## package.json' block is not valid JSON: {exc.msg}")
        return
    if not SCAFFOLD_PACKAGE.is_file():
        report.error(SCAFFOLD_PACKAGE, 1, "scaffold package.json is missing; it must mirror STACK.md's '## package.json' block")
        return
    try:
        got = json.loads(SCAFFOLD_PACKAGE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        report.error(SCAFFOLD_PACKAGE, exc.lineno, f"not valid JSON: {exc.msg}")
        return
    for key in PINNED_PACKAGE_KEYS:
        w, g = want.get(key), got.get(key)
        if w is None:
            report.error(STACK, line0, f"the '## package.json' block has no {key!r}")
        elif w != g:
            report.error(SCAFFOLD_PACKAGE, 1, f"{key} differs from STACK.md: {describe_drift(w, g)}")


def check_addon_block(report: Report) -> None:
    """STACK.md's `## Add-on packages`: exact pins for packages the scaffold does not install."""
    if not STACK.is_file():
        return
    block = fenced_block_after(STACK, r"^##\s+Add-on packages\s*$")
    if block is None:
        report.error(STACK, 1, "no fenced JSON block under '## Add-on packages' (the snippet check installs it)")
        return
    text, line0 = block
    try:
        addons = json.loads(text)
    except json.JSONDecodeError as exc:
        report.error(STACK, line0 + exc.lineno - 1, f"the '## Add-on packages' block is not valid JSON: {exc.msg}")
        return
    if not isinstance(addons, dict):
        report.error(STACK, line0, "the '## Add-on packages' block must be a JSON object")
        return
    baseline: set[str] = set()
    package_block = fenced_block_after(STACK, r"^##\s+package\.json\s*$")
    try:
        baseline_json = json.loads(package_block[0]) if package_block else {}
        baseline = {name for key in ADDON_KEYS for name in baseline_json.get(key, {})}
    except json.JSONDecodeError:
        pass  # check_package_parity reports it
    lines = text.splitlines()

    def line_of(name: str) -> int:
        return line0 + next((i for i, ln in enumerate(lines) if f'"{name}"' in ln), 0)

    for key in sorted(addons.keys() - set(ADDON_KEYS)):
        report.error(STACK, line_of(key), f"'## Add-on packages' may hold only {' and '.join(ADDON_KEYS)}, not {key!r}")
    for key in ADDON_KEYS:
        packages = addons.get(key, {})
        if not isinstance(packages, dict):
            report.error(STACK, line_of(key), f"'## Add-on packages' {key} must map package names to versions")
            continue
        for name, version in packages.items():
            if not (isinstance(version, str) and EXACT_VERSION_RE.match(version)):
                report.error(STACK, line_of(name), f"add-on {name}: {json.dumps(version)} is not an exact version")
            if name in baseline:
                report.error(STACK, line_of(name), f"add-on {name} is already in the '## package.json' block")


def describe_drift(want: object, got: object) -> str:
    if not (isinstance(want, dict) and isinstance(got, dict)):
        return f"STACK.md {json.dumps(want)} vs scaffold {json.dumps(got)}"
    parts = [f"{k} only in STACK.md" for k in sorted(want.keys() - got.keys())]
    parts += [f"{k} only in the scaffold" for k in sorted(got.keys() - want.keys())]
    parts += [f"{k}: STACK.md {json.dumps(want[k])}, scaffold {json.dumps(got[k])}" for k in sorted(want.keys() & got.keys()) if want[k] != got[k]]
    return "; ".join(parts)


def rejected_terms() -> list[tuple[re.Pattern[str], str]]:
    """Backticked names in the first column of STACK.md's `## Rejected` table."""
    if not STACK.is_file():
        return []
    terms: list[tuple[re.Pattern[str], str]] = []
    inside = False
    for ln in STACK.read_text(encoding="utf-8").splitlines():
        if ln.startswith("## "):
            inside = ln.strip() == "## Rejected"
        elif inside and ln.startswith("|"):
            for name in re.findall(r"`([^`]+)`", ln.split("|")[1]):
                n = re.escape(name)
                pattern = rf"(?<=[`'\"]){n}(?=[`'\"/])|(?<![\w@/-]){n}\.js\b" if name in COMMON_WORD_NAMES else rf"(?<![\w@/-]){n}(?![\w-])"
                terms.append((re.compile(pattern, re.IGNORECASE), f"rejected in STACK.md: {name}"))
    return terms


# --------------------------------------------------------------------------- release versions


def manifest_version(text: str, keys: tuple[str, ...]) -> str | None:
    value = json.loads(text)
    for key in keys:
        value = value.get(key) if isinstance(value, dict) else None
    return value if isinstance(value, str) else None


def check_manifest_versions(report: Report) -> None:
    seen: dict[str, list[str]] = {}
    for path, keys in MANIFESTS:
        if not path.is_file():
            report.error(path, 1, "plugin manifest is missing")
            continue
        version = manifest_version(path.read_text(encoding="utf-8"), keys)
        if version is None:
            report.error(path, 1, f"no version at {'.'.join(keys)}")
            continue
        seen.setdefault(version, []).append(f"{path.relative_to(ROOT)}:{'.'.join(keys)}")
    if len(seen) > 1:
        report.error(ROOT / ".claude-plugin" / "plugin.json", 1, f"manifest versions disagree: {seen}")
    codex = ROOT / ".codex-plugin" / "plugin.json"
    if codex.is_file():
        short = json.loads(codex.read_text(encoding="utf-8")).get("interface", {}).get("shortDescription", "")
        if len(short) > SHORT_DESCRIPTION_MAX:
            report.error(codex, 1, f"interface.shortDescription is {len(short)} chars, max {SHORT_DESCRIPTION_MAX}")


def git_show(ref: str, rel: str) -> str | None:
    result = subprocess.run(["git", "show", f"{ref}:{rel}"], cwd=ROOT, capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def check_version_bumps(report: Report, base: str) -> None:
    """A change under skills/<name>/ must bump that skill's metadata.version and the plugin version."""
    diff = subprocess.run(["git", "diff", "--name-only", base, "--", "skills/"], cwd=ROOT, capture_output=True, text=True)
    if diff.returncode != 0:
        report.error(ROOT, 1, f"git diff against {base!r} failed: {diff.stderr.strip()}")
        return
    changed = sorted({Path(p).parts[1] for p in diff.stdout.split() if len(Path(p).parts) > 2})
    version_re = re.compile(r"^  version: *(.+)$", re.MULTILINE)
    for name in changed:
        rel = f"skills/{name}/SKILL.md"
        old = git_show(base, rel)
        path = ROOT / rel
        if old is None or not path.is_file():
            continue
        before, after = version_re.search(old), version_re.search(path.read_text(encoding="utf-8"))
        if before and after and before.group(1) == after.group(1):
            report.error(path, 1, f"skills/{name}/ changed since {base} but metadata.version is still {after.group(1)}")
    if changed:
        rel = ".claude-plugin/plugin.json"
        old = git_show(base, rel)
        if old is not None and manifest_version(old, ("version",)) == manifest_version((ROOT / rel).read_text(encoding="utf-8"), ("version",)):
            report.error(ROOT / rel, 1, f"skills/ changed since {base} but the plugin version did not: installed plugins update only on a version change")


# --------------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true", help="emit findings as JSON")
    parser.add_argument("--strict", action="store_true", help="treat a missing evals/<skill>.md or a missing skill as an error")
    parser.add_argument("--base", metavar="REF", help="require version bumps for skills changed since this git ref")
    args = parser.parse_args()

    report = Report()
    if not SKILLS.is_dir():
        print(f"{SKILLS}: ERROR: skills/ directory not found", file=sys.stderr)
        return 1

    OUT_OF_STACK.extend(rejected_terms())
    skill_dirs = sorted(d for d in SKILLS.iterdir() if d.is_dir() and not d.name.startswith("."))
    total = sum(len(validate_skill(d, report, args.strict)) for d in skill_dirs)
    if total >= DESCRIPTIONS_MAX_CHARS:
        report.error(SKILLS, 1, f"descriptions total {total} chars; all together must stay under {DESCRIPTIONS_MAX_CHARS}")
    for name in sorted(EXPECTED_SKILLS - {d.name for d in skill_dirs}):
        (report.error if args.strict else report.warn)(SKILLS / name, 1, f"skill {name!r} from AGENTS.md does not exist yet")
    check_stray_skill_files(report)
    check_package_parity(report)
    check_addon_block(report)
    check_manifest_versions(report)
    if args.base:
        check_version_bumps(report, args.base)

    if args.json:
        print(json.dumps([asdict(f) for f in report.findings], indent=2))
    else:
        for finding in report.findings:
            print(finding.render())
        warns = len(report.findings) - report.error_count
        print(f"\n{len(skill_dirs)} skill(s) checked: {report.error_count} error(s), {warns} warning(s)")
    return 1 if report.error_count else 0


if __name__ == "__main__":
    sys.exit(main())
