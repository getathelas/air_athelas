#!/usr/bin/env python3

with open('master_changelogs/changelog.mdx', 'r') as f:
    content = f.read()

# Fix the specific issue on line 91
content = content.replace(
    '  This will additionally improve accuracy of retrospective performance metrics.\n  **Scribe "Fast mode" generates 5-7x faster**',
    '  This will additionally improve accuracy of retrospective performance metrics.\n\n  **Scribe "Fast mode" generates 5-7x faster**'
)

with open('master_changelogs/changelog.mdx', 'w') as f:
    f.write(content)

print("Fixed line 91!")
