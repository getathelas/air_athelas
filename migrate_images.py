#!/usr/bin/env python3
"""
Image migration script for air_athelas repository reorganization.
This script moves and renames images based on their references in MDX files.
"""

import os
import re
import shutil
from pathlib import Path
from collections import defaultdict

# Base paths
BASE_DIR = Path("/Users/seanshen/Repo/air_athelas")
IMAGES_DIR = BASE_DIR / "images"
OLD_IMAGES_DIR = IMAGES_DIR

# Mapping of MDX files to their new locations (without .mdx extension)
MDX_MAPPING = {
    # air_onboard
    "index": "air_onboard/getting_started_with_air/index",
    "set-up": "air_onboard/getting_started_with_air/set_up",
    "troubleshoot/faqs": "air_onboard/getting_started_with_air/faqs",
    
    # air_provider - review_patient_details
    "patient_details/patient_info": "air_provider/review_patient_details/patient_info",
    "patient_details/patient_demog": "air_provider/review_patient_details/patient_demog",
    "patient_details/patient_appts": "air_provider/review_patient_details/patient_appts",
    "patient_details/patient_attachments": "air_provider/review_patient_details/patient_attachments",
    
    # air_provider - check_in_a_patient
    "check-in/check-in": "air_provider/check_in_a_patient/check_in",
    "check-in/edit_appt": "air_provider/check_in_a_patient/edit_appt",
    
    # air_provider - fill_a_chart_note
    "chart_note/nav_chart_note": "air_provider/fill_a_chart_note/nav_chart_note",
    "chart_note/other_sec_chart_note": "air_provider/fill_a_chart_note/other_sec_chart_note",
    "chart_note/flowsheets": "air_provider/fill_a_chart_note/flowsheets",
    "chart_note/functional_outcomes": "air_provider/fill_a_chart_note/functional_outcomes",
    "chart_note/medications": "air_provider/fill_a_chart_note/medications",
    "chart_note/prescriber_agents": "air_provider/fill_a_chart_note/prescriber_agents",
    "chart_note/scribe_faq": "air_provider/fill_a_chart_note/scribe_faq",
    "inbox/nav_inbox": "air_provider/fill_a_chart_note/nav_inbox",
    
    # air_front_desk - view_your_calendar
    "calendar/nav_calendar": "air_front_desk/view_your_calendar/nav_calendar",
    
    # air_front_desk - communicate_with_patients
    "messages/messages": "air_front_desk/communicate_with_patients/messages",
    
    # air_front_desk - take_in_a_patient
    "front_desk/new_appt": "air_front_desk/take_in_a_patient/new_appt",
    "front_desk/prep_appt": "air_front_desk/take_in_a_patient/prep_appt",
    
    # air_front_desk - manage_your_tasks
    "front_desk/faxes": "air_front_desk/manage_your_tasks/faxes",
    "front_desk/tasks": "air_front_desk/manage_your_tasks/tasks",
    "front_desk/lead_tracker_use": "air_front_desk/manage_your_tasks/lead_tracker_use",
    
    # air_admin - manage_your_practice
    "admin/practice_settings": "air_admin/manage_your_practice/practice_settings",
    "admin/appointment_types": "air_admin/manage_your_practice/appointment_types",
    "admin/chart_note_templates": "air_admin/manage_your_practice/chart_note_templates",
    "admin/patient_workflows": "air_admin/manage_your_practice/patient_workflows",
    "admin/provider_settings": "air_admin/manage_your_practice/provider_settings",
    "admin/provider_credentials": "air_admin/manage_your_practice/provider_credentials",
    "admin/calendar_settings": "air_admin/manage_your_practice/calendar_settings",
    "admin/register_providers_rx": "air_admin/manage_your_practice/register_providers_rx",
    "admin/fax_admin": "air_admin/manage_your_practice/fax_admin",
    
    # air_admin - analyze_your_reports
    "reports/kpi_dashboard": "air_admin/analyze_your_reports/kpi_dashboard",
    "reports/all_reports": "air_admin/analyze_your_reports/all_reports",
    
    # insights_onboard
    "insights/insights_landing": "insights_onboard/insights/insights_landing",
    
    # master_blogs
    "blogs/product_release": "master_blogs/product_release",
    "blogs/customer_stories": "master_blogs/customer_stories",
    "blogs/kx_modifier": "master_blogs/kx_modifier",
    "blogs/lead_tracker": "master_blogs/lead_tracker",
    "blogs/new_calendar": "master_blogs/new_calendar",
    "blogs/agents_center": "master_blogs/agents_center",
    "blogs/ai_assistant": "master_blogs/ai_assistant",
    
    # master_changelogs
    "changelog": "master_changelogs/changelog",
}

def extract_images_from_mdx(mdx_path):
    """Extract all image references from an MDX file."""
    images = []
    try:
        with open(mdx_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
            # Pattern 1: ![alt text](/images/filename.ext)
            pattern1 = r'!\[.*?\]\(/images/([^)]+)\)'
            images.extend(re.findall(pattern1, content))
            
            # Pattern 2: src="/images/filename.ext"
            pattern2 = r'src="/images/([^"]+)"'
            images.extend(re.findall(pattern2, content))
            
            # Pattern 3: <img ... src="/images/filename.ext"
            pattern3 = r'<img[^>]*src="/images/([^"]+)"'
            images.extend(re.findall(pattern3, content))
            
    except Exception as e:
        print(f"Error reading {mdx_path}: {e}")
    
    return list(set(images))  # Remove duplicates

def build_image_mapping():
    """Build a mapping of images to their target MDX files."""
    image_to_mdx = defaultdict(list)
    
    for old_path, new_path in MDX_MAPPING.items():
        old_mdx_path = BASE_DIR / f"{old_path}.mdx"
        new_mdx_path = BASE_DIR / f"{new_path}.mdx"
        
        # Check both old and new locations
        mdx_path = new_mdx_path if new_mdx_path.exists() else old_mdx_path
        
        if mdx_path.exists():
            images = extract_images_from_mdx(mdx_path)
            mdx_name = Path(new_path).name  # Get just the filename without path
            for img in images:
                image_to_mdx[img].append((new_path, mdx_name))
    
    return image_to_mdx

def move_and_rename_images(image_mapping):
    """Move and rename images to their new locations."""
    moved_count = 0
    error_count = 0
    
    for old_img_path, mdx_locations in image_mapping.items():
        source = IMAGES_DIR / old_img_path
        
        if not source.exists():
            print(f"Warning: Image not found: {old_img_path}")
            error_count += 1
            continue
        
        # If image is referenced by multiple MDX files, use the first one
        # (or we could copy to multiple locations)
        if mdx_locations:
            new_path, mdx_name = mdx_locations[0]
            
            # Get file extension
            ext = source.suffix
            
            # Determine the target directory
            target_dir = IMAGES_DIR / Path(new_path).parent / mdx_name
            target_dir.mkdir(parents=True, exist_ok=True)
            
            # Count existing files with same mdx_name prefix
            existing_files = list(target_dir.glob(f"{mdx_name}_*{ext}"))
            next_num = len(existing_files) + 1
            
            # Create new filename
            new_filename = f"{mdx_name}_{next_num}{ext}"
            target = target_dir / new_filename
            
            try:
                shutil.copy2(source, target)
                print(f"Copied: {old_img_path} -> {target.relative_to(IMAGES_DIR)}")
                moved_count += 1
            except Exception as e:
                print(f"Error copying {old_img_path}: {e}")
                error_count += 1
    
    return moved_count, error_count

def main():
    print("Starting image migration...")
    print(f"Base directory: {BASE_DIR}")
    print(f"Images directory: {IMAGES_DIR}")
    print()
    
    # Build image mapping
    print("Building image mapping from MDX files...")
    image_mapping = build_image_mapping()
    print(f"Found {len(image_mapping)} unique images referenced in MDX files")
    print()
    
    # Move and rename images
    print("Moving and renaming images...")
    moved, errors = move_and_rename_images(image_mapping)
    print()
    print(f"Migration complete!")
    print(f"  Moved: {moved} images")
    print(f"  Errors: {errors} images")

if __name__ == "__main__":
    main()
