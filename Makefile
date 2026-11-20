.PHONY: check validate snippets lint evals

CLAUDE ?= claude
EVAL_ARGS ?=

# Both must be green before review; CI also runs lint and `claude plugin validate --strict .`.
check: validate snippets

# Frontmatter, budgets, ownership hygiene, manifests, STACK.md <-> scaffold package.json parity.
validate:
	python3 scripts/validate_skills.py

# Copy the scaffold to $TMPDIR/frontend-powers-verify, add STACK.md's add-on packages and every ```ts,verify block, then tsc + Biome + Vitest.
snippets:
	python3 scripts/check_snippets.py

# --config keeps prek out of the scaffold's own hook set, whose pnpm commands would install into skills/.
lint:
	prek run --all-files --config .pre-commit-config.yaml

# Billed model calls on your account: run before a release or when a new model ships, never in CI.
evals:
	python3 scripts/build_eval_cases.py
	$(CLAUDE) plugin eval evals/.run --eval-dir cases --scaffold --no-publish $(EVAL_ARGS)
