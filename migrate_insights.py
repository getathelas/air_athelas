#!/usr/bin/env python3
"""
Migration script to restructure insights documentation to match air formatting.
Converts folder/file names from kebab-case to snake_case and reorganizes structure.
"""

import os
import re
import shutil
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path("/Users/seanshen/Repo/air_athelas")
IMAGES_DIR = BASE_DIR / "images"

# Folder mapping: old -> new
FOLDER_MAPPING = {
    "Billing-Workflows": "insights_biller",
    "Front-Office-Workflows": "insights_front_desk",
    "Owners-&-Administration": "insights_admin",
    "Onboarding-Documents": "insights_onboard",
    "Provider-Workflows": "insights_provider",
}

def kebab_to_snake(name):
    """Convert kebab-case to snake_case."""
    return name.replace("-", "_").lower()

def build_migration_mapping():
    """Build a mapping of old paths to new paths for all MDX files."""
    mapping = {}
    
    for old_folder, new_folder in FOLDER_MAPPING.items():
        old_folder_path = BASE_DIR / old_folder
        if not old_folder_path.exists():
            continue
            
        for mdx_file in old_folder_path.rglob("*.mdx"):
            # Get relative path from old folder
            rel_path = mdx_file.relative_to(old_folder_path)
            
            # Convert all parts to snake_case
            parts = list(rel_path.parts)
            new_parts = []
            for part in parts:
                if part.endswith('.mdx'):
                    new_parts.append(kebab_to_snake(part))
                else:
                    new_parts.append(kebab_to_snake(part))
            
            # Build new path
            new_path = BASE_DIR / new_folder / Path(*new_parts)
            
            mapping[mdx_file] = new_path
    
    return mapping

def migrate_mdx_files(mapping):
    """Move and rename MDX files."""
    migrated = 0
    errors = 0
    
    for old_path, new_path in mapping.items():
        try:
            # Create parent directory
            new_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Copy file to new location
            shutil.copy2(old_path, new_path)
            print(f"Migrated: {old_path.relative_to(BASE_DIR)} -> {new_path.relative_to(BASE_DIR)}")
            migrated += 1
        except Exception as e:
            print(f"Error migrating {old_path}: {e}")
            errors += 1
    
    return migrated, errors

def migrate_images_for_mdx(old_mdx_path, new_mdx_path):
    """Migrate images for a specific MDX file."""
    # Get old MDX structure
    old_folder_name = None
    for old_folder in FOLDER_MAPPING.keys():
        if str(old_mdx_path).startswith(str(BASE_DIR / old_folder)):
            old_folder_name = old_folder
            break
    
    if not old_folder_name:
        return [], 0, 0
    
    # Get relative path from old folder
    old_rel_path = old_mdx_path.relative_to(BASE_DIR / old_folder_name)
    old_mdx_name = old_rel_path.stem  # filename without extension
    old_activity_folder = old_rel_path.parent.parts[0] if old_rel_path.parent.parts else ""
    
    # Get new MDX structure
    new_folder_name = FOLDER_MAPPING[old_folder_name]
    new_rel_path = new_mdx_path.relative_to(BASE_DIR / new_folder_name)
    new_mdx_name = new_rel_path.stem
    new_activity_folder = new_rel_path.parent.parts[0] if new_rel_path.parent.parts else ""
    
    # Find images in old structure
    old_img_dir = IMAGES_DIR / old_folder_name / old_activity_folder / old_mdx_name
    migrated_images = []
    migrated_count = 0
    error_count = 0
    
    if old_img_dir.exists():
        # Create new image directory
        if new_activity_folder:
            new_img_dir = IMAGES_DIR / new_folder_name / new_activity_folder / new_mdx_name
        else:
            new_img_dir = IMAGES_DIR / new_folder_name / new_mdx_name
        
        new_img_dir.mkdir(parents=True, exist_ok=True)
        
        # Migrate all images in the directory
        for old_img_file in old_img_dir.iterdir():
            if old_img_file.is_file() and old_img_file.suffix in ['.png', '.webp', '.gif', '.jpeg', '.jpg']:
                # Convert filename from kebab-case to snake_case
                old_name = old_img_file.stem
                ext = old_img_file.suffix
                
                # Handle numbered images: "the-denials-analysis-page-1" -> "the_denials_analysis_page_1"
                match = re.match(r'(.+?)-(\d+)$', old_name)
                if match:
                    base_name = kebab_to_snake(match.group(1))
                    num = match.group(2)
                    new_name = f"{base_name}_{num}{ext}"
                else:
                    # No number, just convert
                    new_name = f"{kebab_to_snake(old_name)}{ext}"
                
                new_img_path = new_img_dir / new_name
                
                try:
                    shutil.copy2(old_img_file, new_img_path)
                    migrated_images.append((old_img_file, new_img_path))
                    migrated_count += 1
                except Exception as e:
                    print(f"Error migrating image {old_img_file}: {e}")
                    error_count += 1
    
    return migrated_images, migrated_count, error_count

def migrate_all_images(mdx_mapping):
    """Migrate all images."""
    total_migrated = 0
    total_errors = 0
    image_mapping = {}  # old_path -> new_path
    
    for old_mdx_path, new_mdx_path in mdx_mapping.items():
        migrated_images, migrated_count, error_count = migrate_images_for_mdx(old_mdx_path, new_mdx_path)
        total_migrated += migrated_count
        total_errors += error_count
        
        for old_img, new_img in migrated_images:
            image_mapping[old_img] = new_img
    
    return total_migrated, total_errors, image_mapping

def update_image_references_in_mdx(mdx_mapping, image_mapping):
    """Update image references in MDX files."""
    updated = 0
    errors = 0
    
    # Build reverse lookup: old image path string -> new image path string
    old_to_new_paths = {}
    for old_img_path, new_img_path in image_mapping.items():
        # Create the old reference path (as it appears in MDX)
        old_ref = f"/images/{old_img_path.relative_to(IMAGES_DIR)}"
        new_ref = f"/images/{new_img_path.relative_to(IMAGES_DIR)}"
        old_to_new_paths[old_ref] = new_ref
        
        # Also try with different path formats
        # Sometimes the path might be relative to the old folder structure
        for old_folder in FOLDER_MAPPING.keys():
            if str(old_img_path).startswith(str(IMAGES_DIR / old_folder)):
                rel_path = old_img_path.relative_to(IMAGES_DIR / old_folder)
                alt_old_ref = f"/images/{old_folder}/{rel_path}"
                old_to_new_paths[alt_old_ref] = new_ref
    
    for old_mdx_path, new_mdx_path in mdx_mapping.items():
        try:
            with open(new_mdx_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            original_content = content
            
            # Replace all image references
            # Pattern 1: <img src="/images/...">
            def replace_img_src(match):
                old_ref = match.group(1)
                if old_ref in old_to_new_paths:
                    return f'src="{old_to_new_paths[old_ref]}"'
                return match.group(0)
            
            content = re.sub(r'src="(/images/[^"]+)"', replace_img_src, content)
            
            # Pattern 2: ![alt](/images/...)
            def replace_markdown_img(match):
                alt_text = match.group(1)
                old_ref = match.group(2)
                if old_ref in old_to_new_paths:
                    return f'![{alt_text}]({old_to_new_paths[old_ref]})'
                return match.group(0)
            
            content = re.sub(r'!\[([^\]]*)\]\((/images/[^)]+)\)', replace_markdown_img, content)
            
            if content != original_content:
                with open(new_mdx_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                updated += 1
                print(f"Updated references in: {new_mdx_path.relative_to(BASE_DIR)}")
        except Exception as e:
            print(f"Error updating {new_mdx_path}: {e}")
            errors += 1
    
    return updated, errors

def create_empty_folders():
    """Create insights_hidden and insights_archive folders."""
    for folder_name in ["insights_hidden", "insights_archive"]:
        folder_path = BASE_DIR / folder_name
        folder_path.mkdir(exist_ok=True)
        print(f"Created folder: {folder_name}")

def replace_insights_onboard():
    """Replace existing insights_onboard with Onboarding-Documents content."""
    old_onboard = BASE_DIR / "insights_onboard"
    if old_onboard.exists():
        # Remove the old insights folder
        if (old_onboard / "insights").exists():
            shutil.rmtree(old_onboard / "insights")
        if old_onboard.exists() and not any(old_onboard.iterdir()):
            old_onboard.rmdir()
        print("Removed old insights_onboard content")

def main():
    print("=" * 60)
    print("Insights Documentation Migration")
    print("=" * 60)
    print()
    
    # Step 1: Create empty folders
    print("Step 1: Creating insights_hidden and insights_archive folders...")
    create_empty_folders()
    print()
    
    # Step 1.5: Replace old insights_onboard
    print("Step 1.5: Replacing old insights_onboard...")
    replace_insights_onboard()
    print()
    
    # Step 2: Build migration mapping
    print("Step 2: Building migration mapping...")
    mdx_mapping = build_migration_mapping()
    print(f"Found {len(mdx_mapping)} MDX files to migrate")
    print()
    
    # Step 3: Migrate MDX files
    print("Step 3: Migrating MDX files...")
    migrated_mdx, errors_mdx = migrate_mdx_files(mdx_mapping)
    print(f"Migrated {migrated_mdx} MDX files, {errors_mdx} errors")
    print()
    
    # Step 4: Migrate images
    print("Step 4: Migrating images...")
    migrated_img, errors_img, image_mapping = migrate_all_images(mdx_mapping)
    print(f"Migrated {migrated_img} images, {errors_img} errors")
    print()
    
    # Step 5: Update image references
    print("Step 5: Updating image references in MDX files...")
    updated_refs, errors_refs = update_image_references_in_mdx(mdx_mapping, image_mapping)
    print(f"Updated {updated_refs} MDX files, {errors_refs} errors")
    print()
    
    print("=" * 60)
    print("Migration Summary")
    print("=" * 60)
    print(f"MDX files migrated: {migrated_mdx}")
    print(f"Images migrated: {migrated_img}")
    print(f"MDX files with updated references: {updated_refs}")
    print()
    print("Next steps:")
    print("1. Review the migrated files")
    print("2. Update docs.json navigation")
    print("3. Delete old folders after verification")

if __name__ == "__main__":
    main()
