#!/usr/bin/env python3
"""
Check all MDX files for mismatches between sidebarTitle and title.
"""
import os
import re
from pathlib import Path

def extract_frontmatter(content):
    """Extract YAML frontmatter from MDX file."""
    # Match frontmatter between --- markers
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return {}
    
    frontmatter_text = match.group(1)
    frontmatter = {}
    
    # Simple YAML parsing for title and sidebarTitle
    for line in frontmatter_text.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        
        # Match key: "value" or key: value
        match = re.match(r'^(\w+):\s*["\']?(.*?)["\']?$', line)
        if match:
            key = match.group(1)
            value = match.group(2)
            frontmatter[key] = value
    
    return frontmatter

def check_mdx_files(root_dir):
    """Check all MDX files for title/sidebarTitle mismatches."""
    mismatches = []
    missing_sidebar = []
    
    root_path = Path(root_dir)
    for mdx_file in root_path.rglob('*.mdx'):
        try:
            with open(mdx_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            frontmatter = extract_frontmatter(content)
            title = frontmatter.get('title', '').strip()
            sidebar_title = frontmatter.get('sidebarTitle', '').strip()
            
            if not title:
                continue  # Skip files without title
            
            if not sidebar_title:
                missing_sidebar.append((str(mdx_file.relative_to(root_path)), title))
            elif title != sidebar_title:
                mismatches.append((
                    str(mdx_file.relative_to(root_path)),
                    title,
                    sidebar_title
                ))
        except Exception as e:
            print(f"Error reading {mdx_file}: {e}")
    
    return mismatches, missing_sidebar

if __name__ == '__main__':
    root_dir = '/Users/seanshen/Repo/air_athelas'
    mismatches, missing_sidebar = check_mdx_files(root_dir)
    
    print("=" * 80)
    print("FILES WITH DIFFERENT sidebarTitle AND title:")
    print("=" * 80)
    
    if mismatches:
        for file_path, title, sidebar_title in mismatches:
            print(f"\n📄 {file_path}")
            print(f"   title:        {title}")
            print(f"   sidebarTitle: {sidebar_title}")
    else:
        print("\n✅ No mismatches found!")
    
    print("\n" + "=" * 80)
    print("FILES WITH title BUT NO sidebarTitle:")
    print("=" * 80)
    
    if missing_sidebar:
        for file_path, title in missing_sidebar:
            print(f"\n📄 {file_path}")
            print(f"   title: {title}")
    else:
        print("\n✅ All files with title also have sidebarTitle!")
    
    print(f"\n\nSummary:")
    print(f"  - Files with mismatched titles: {len(mismatches)}")
    print(f"  - Files missing sidebarTitle: {len(missing_sidebar)}")
