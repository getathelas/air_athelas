# AGENTS.md

This repository is the **Mintlify documentation site** for Air (the EHR) and Insights (the billing platform), deployed to docs.athelas.com. It is content-only: MDX pages, images/videos, and `docs.json` navigation. Authoring conventions live in `.cursor/rules/doc_writer.mdc`.

## Cursor Cloud specific instructions

- **No dependencies to install.** There is no `package.json`/lockfile. The Mintlify CLI is run on demand via `npx mint@latest ...` (Node is already present). Nothing is needed in the startup update script.
- **Run the docs locally:** `npx -y mint@latest dev --port <port>` from the repo root, then open the served URL (root path 307-redirects to the Air welcome page).
- **Proofread before PRs:** `python3 scripts/proofread.py` checks the .mdx files changed against `main` for mechanical copyedit errors and exits non-zero on a hit. `--all` scans the whole repo, `--pronouns <file>` lists every pronoun to confirm against its antecedent. A clean run is not a proofread — see the copyedit pass in `.cursor/rules/doc_writer.mdc` section 5 for what a regex cannot catch.
- **Validate before PRs:** `npx -y mint@latest validate` (build check) and `npx -y mint@latest broken-links` (link check). Validation passes; it prints a benign `Error generating favicons ... athelas_favicon_bkg.png` warning because that favicon file referenced in `docs.json` is not checked in — this is not fatal.
