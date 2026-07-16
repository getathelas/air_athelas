# AGENTS.md

This repository is the **Mintlify documentation site** for Athelas Air & Insights (deployed to docs.athelas.com). It is content-only: MDX pages, images/videos, and `docs.json` navigation. Authoring conventions live in `.cursor/rules/doc_writer.mdc`.

## Cursor Cloud specific instructions

- **No dependencies to install.** There is no `package.json`/lockfile. The Mintlify CLI is run on demand via `npx mint@latest ...` (Node is already present). Nothing is needed in the startup update script.
- **Run the docs locally:** `npx -y mint@latest dev --port <port>` from the repo root, then open the served URL (root path 307-redirects to the Air welcome page).
- **Validate before PRs:** `npx -y mint@latest validate` (build check) and `npx -y mint@latest broken-links` (link check). Validation passes; it prints a benign `Error generating favicons ... athelas_favicon_bkg.png` warning because that favicon file referenced in `docs.json` is not checked in — this is not fatal.
