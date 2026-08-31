#!/usr/bin/env python3
"""Copyedit checker for the MDX docs.

    python3 scripts/proofread.py              # files changed vs origin/main
    python3 scripts/proofread.py --all        # every .mdx in the repo
    python3 scripts/proofread.py <paths...>   # specific files or folders
    python3 scripts/proofread.py --pronouns <paths...>

Default mode reports only mechanical errors, so a clean run means something. It
scopes to changed files because the repo still carries a backlog of pre-existing
hits -- run `--all` to see that backlog.

A clean run is not a proofread. The checker cannot see an ambiguous pronoun, a
sentence fragment, or a claim that is simply wrong. `--pronouns` lists every
pronoun for a human to confirm; the copyedit pass in
`.cursor/rules/doc_writer.mdc` section 5 covers the rest. No dependencies.
"""

import os
import re
import subprocess
import sys

SKIP_DIRS = {".git", "node_modules", "_scratch", "images", ".claude", ".github"}

# Markup is replaced with U+FFFD rather than a space: it keeps words from
# becoming accidentally adjacent, and never matches \w, \s or a vowel class, so
# no check can fire across a stripped span.
NUL = "�"
FENCE = re.compile(r"^\s*(```|~~~)")
STRIP = [
    (re.compile(r"`[^`]*`"), NUL),
    (re.compile(r"<[^<>]+>"), NUL),
    (re.compile(r"\]\([^)]*\)"), "]"),
    (re.compile(r"https?://\S+"), NUL),
    (re.compile(r"\{[^{}]*\}"), NUL),
    (re.compile(r"\|"), NUL),
]

MODALS = r"can|could|will|would|shall|should|may|might|must"
# Words that legitimately follow a modal despite ending in -s. Anything ending
# in -ss or -us is allowed automatically.
LY_ADJECTIVES = ("timely|early|only|likely|friendly|lonely|lively|costly|orderly|elderly|daily|weekly|biweekly|monthly|quarterly|yearly|hourly|ugly|holy|silly|family")

MODAL_OK = {"sometimes", "always", "perhaps", "otherwise", "likewise", "its",
            "this", "yes", "status", "analysis", "basis"}

# Product names reverted on 2026-08-31 (see doc_writer.mdc section 2). "Air Clinical"
# and "Air Billing" shipped on 2026-08-21 and appear nowhere on athelas.com; externally
# the EHR is "Air" and the billing platform is "Insights".
BANNED_NAME = re.compile(r"\bAir[ \t]+(?:Clinical|Billing)\b")

# Prices a practice pays us or a vendor do not belong on the public docs (Hersh,
# 2026-08-29). Deliberately narrow: a figure bound to a per-unit phrase. The
# domain vocabulary this product is full of -- fee schedules, copays, allowed
# amounts, no-show fees, Medicare therapy thresholds -- is what patients and
# payers pay, and must not trip. A figure inside backticks is exempt, since STRIP
# removes it; use that for workflow thresholds.
OUR_PRICING = re.compile(
    r"\\?\$[\d,.]+\s*(?:per|/)\s*"
    r"(?:statement|recipient|transaction|provider|seat|user|month|encounter)\b"
    r"|\d+(?:\.\d+)?%\s*\+\s*\\?\$[\d.]+")

CHECKS = [
    ("doubled-word",
     re.compile(r"\b(?!that\b|had\b)(\w+)\s+\1\b", re.I),
     "word repeated twice in a row"),
    ("modal-verb",
     re.compile(r"\b(?:" + MODALS + r")\s+(?:\w+ly\s+|now\s+|also\s+|then\s+|still\s+|only\s+)?"
                r"([a-z]+s)\b", re.I),
     "modal followed by an inflected verb (use the bare infinitive)"),
    ("ly-hyphen",
     re.compile(r"\b(?!(?:" + LY_ADJECTIVES + r")-)(\w+ly)-\w+", re.I),
     "an -ly adverb is never hyphenated to the word it modifies"),
    ("space-before-punct",
     re.compile(r"\w[ \t]+[,.;:!?](?:\s|$)"),
     "space before punctuation"),
    ("trailing-space",
     re.compile(r"[ \t]+$"),
     "trailing whitespace"),
    ("self-domain-link",
     re.compile(r"https?://(?:docs|trainings\.air)\.athelas\.com\S*"),
     "link to this site's own domain; use a relative path so broken-links can see it"),
    ("our-pricing",
     OUR_PRICING,
     "a price the practice pays us or a vendor; state the duty, not the number"),
    ("banned-product-name",
     BANNED_NAME,
     "reverted product name; the EHR is \"Air\" and the billing platform is \"Insights\""),
    ("a-an",
     re.compile(r"\ba\s+(?=[aeio])(?!(?:one|once|eu)\w*\b)[a-z]+\b"),
     "'a' before a vowel sound (use 'an')"),
    ("an-a",
     re.compile(r"\ban\s+(?![aeiou])(?!(?:hour|honest|honor|heir)\w*\b)[a-z]+\b"),
     "'an' before a consonant sound (use 'a')"),
]

PRONOUNS = re.compile(r"(?<![\w'])(it|its|this|they|them|these|those)(?![\w'])", re.I)


def prose(line):
    for pat, rep in STRIP:
        line = pat.sub(rep, line)
    return line


def is_markup(line):
    """JSX, imports and structural lines are not prose. Table cells are."""
    stripped = line.strip()
    return (stripped.startswith(("import ", "export ", "<", "/>"))
            or stripped in ("---", ""))


def scan(path, pronoun_mode):
    hits = []
    in_fence = False
    lines = open(path, encoding="utf-8").read().split("\n")
    start = 1
    if lines and lines[0].strip() == "---":            # skip YAML frontmatter
        for i, raw in enumerate(lines[1:], 2):
            if raw.strip() == "---":
                start = i + 1
                break

    # Banned product names are scanned over the whole file, frontmatter included: most
    # of the 2026-08 rename lived in `title:` and `description:` fields, which the main
    # loop skips.
    if not pronoun_mode:
        for i, raw in enumerate(lines, 1):
            for m in BANNED_NAME.finditer(raw):
                hits.append((i, "banned-product-name",
                             "reverted product name; use \"Air\" (EHR) or \"Insights\" (billing)",
                             m.group(0)))

    for i, raw in enumerate(lines[start - 1:], start):
        if FENCE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        if pronoun_mode:
            if is_markup(raw):
                continue
            text = prose(raw)
            clean = text.replace(NUL, " ")
            for m in PRONOUNS.finditer(clean):
                lo, hi = max(0, m.start() - 55), m.end() + 55
                window = ("..." if lo else "") + " ".join(clean[lo:hi].split()) + \
                         ("..." if hi < len(clean) else "")
                hits.append((i, m.group(1).lower(), window))
            continue

        text = prose(raw)
        for name, pat, msg in CHECKS:
            if name == "trailing-space":
                m = pat.search(raw)
                if m:
                    hits.append((i, name, msg, "%d space(s)" % len(m.group(0))))
                continue
            if name == "banned-product-name":
                continue            # already handled in the whole-file pre-pass
            if name == "self-domain-link":
                # A URL inside backticks is displayed as text, not linked.
                for m in pat.finditer(re.sub(r"`[^`]*`", NUL, raw)):
                    hits.append((i, name, msg, m.group(0)))
                continue
            if is_markup(raw):
                continue
            for m in pat.finditer(text):
                if name == "modal-verb":
                    word = m.group(1).lower()
                    if word in MODAL_OK or word.endswith(("ss", "us")):
                        continue
                hits.append((i, name, msg, m.group(0).strip()))
    return hits


def changed_files():
    for base in ("origin/main", "main"):
        try:
            merge_base = subprocess.check_output(
                ["git", "merge-base", base, "HEAD"], text=True,
                stderr=subprocess.DEVNULL).strip()
        except subprocess.CalledProcessError:
            continue
        names = subprocess.check_output(
            ["git", "diff", "--name-only", "--diff-filter=d", merge_base],
            text=True).split()
        return [n for n in names if n.endswith(".mdx") and os.path.exists(n)]
    return []


def walk(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for root, dirs, files in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
            for f in sorted(files):
                if f.endswith(".mdx"):
                    yield os.path.join(root, f)


def main(argv):
    flags = {a for a in argv[1:] if a.startswith("--")}
    paths = [a for a in argv[1:] if not a.startswith("--")]
    pronoun_mode = "--pronouns" in flags

    if paths:
        targets = list(walk(paths))
    elif "--all" in flags:
        targets = list(walk(["."]))
    else:
        targets = changed_files()
        if not targets:
            print("No changed .mdx files vs main. Use --all to scan the repo.")
            return 0
        print("Scanning %d changed file(s) vs main.\n" % len(targets))

    total = 0
    for path in targets:
        hits = scan(path, pronoun_mode)
        if not hits:
            continue
        total += len(hits)
        for hit in hits:
            if pronoun_mode:
                line, word, text = hit
                print("%s:%d  %-6s %s" % (path, line, word, text[:110]))
            else:
                line, name, msg, snippet = hit
                print("%s:%d  %-18s %s -- %r" % (path, line, name, msg, snippet))

    if pronoun_mode:
        print("\n%d pronoun(s) to confirm. Each must have exactly one possible "
              "antecedent, and it must be the intended noun." % total)
        return 0
    print("\n%d issue(s)." % total if total else "Clean.")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
