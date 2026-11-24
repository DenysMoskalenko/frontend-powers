.PHONY: check validate snippets lint test-scripts plugin-validate evals

CLAUDE ?= claude
EVAL_ARGS ?=
# The branch a pull request merges into; `--base` fails a skill change without a version bump.
BASE ?= origin/main

# Everything the CI `check` job runs; green here predicts a green pull request.
check: validate test-scripts lint plugin-validate snippets

# Frontmatter, budgets, ownership hygiene, manifests, STACK.md parity and every copy of a pinned version.
validate:
	@if git rev-parse --verify --quiet "$(BASE)^{commit}" >/dev/null; then \
		python3 scripts/validate_skills.py --strict --base "$(BASE)"; \
	else \
		echo "make validate: ref '$(BASE)' not found (git fetch origin main, or BASE=<ref>); skipping the version-bump check"; \
		python3 scripts/validate_skills.py --strict; \
	fi

# Seeds a violation per validator check into a temporary copy and asserts the error; also the build_eval_cases.py guard.
test-scripts:
	python3 -B scripts/test_validate_skills.py

# Copy the scaffold to $TMPDIR/frontend-powers-verify, add STACK.md's add-on packages and every ```ts,verify block, then tsc + Biome + Vitest.
snippets:
	python3 scripts/check_snippets.py

# --config keeps prek out of the scaffold's own hook set, whose pnpm commands would install into skills/.
lint:
	prek run --all-files --config .pre-commit-config.yaml

# Manifests, the marketplace file and each SKILL.md's YAML; needs no credentials.
plugin-validate:
	@if command -v $(CLAUDE) >/dev/null 2>&1; then \
		$(CLAUDE) plugin validate --strict .; \
	else \
		echo "make plugin-validate: '$(CLAUDE)' not installed; skipping (CI runs it)"; \
	fi

# Billed model calls on your account: run before a release or when a new model ships, never in CI.
evals:
	python3 scripts/build_eval_cases.py
	$(CLAUDE) plugin eval evals/.run --eval-dir cases --scaffold --no-publish $(EVAL_ARGS)
