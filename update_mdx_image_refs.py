#!/usr/bin/env python3
"""
Update image references in MDX files to point to new locations.
"""

import os
import re
from pathlib import Path

BASE_DIR = Path("/Users/seanshen/Repo/air_athelas")
IMAGES_DIR = BASE_DIR / "images"

# All new MDX file locations
MDX_FILES = [
    # air_onboard
    "air_onboard/getting_started_with_air/index.mdx",
    "air_onboard/getting_started_with_air/set_up.mdx",
    "air_onboard/getting_started_with_air/faqs.mdx",
    
    # air_provider - review_patient_details
    "air_provider/review_patient_details/patient_info.mdx",
    "air_provider/review_patient_details/patient_demog.mdx",
    "air_provider/review_patient_details/patient_appts.mdx",
    "air_provider/review_patient_details/patient_attachments.mdx",
    
    # air_provider - check_in_a_patient
    "air_provider/check_in_a_patient/check_in.mdx",
    "air_provider/check_in_a_patient/edit_appt.mdx",
    
    # air_provider - fill_a_chart_note
    "air_provider/fill_a_chart_note/nav_chart_note.mdx",
    "air_provider/fill_a_chart_note/other_sec_chart_note.mdx",
    "air_provider/fill_a_chart_note/flowsheets.mdx",
    "air_provider/fill_a_chart_note/functional_outcomes.mdx",
    "air_provider/fill_a_chart_note/medications.mdx",
    "air_provider/fill_a_chart_note/prescriber_agents.mdx",
    "air_provider/fill_a_chart_note/scribe_faq.mdx",
    "air_provider/fill_a_chart_note/nav_inbox.mdx",
    
    # air_front_desk
    "air_front_desk/view_your_calendar/nav_calendar.mdx",
    "air_front_desk/communicate_with_patients/messages.mdx",
    "air_front_desk/take_in_a_patient/new_appt.mdx",
    "air_front_desk/take_in_a_patient/prep_appt.mdx",
    "air_front_desk/manage_your_tasks/faxes.mdx",
    "air_front_desk/manage_your_tasks/tasks.mdx",
    "air_front_desk/manage_your_tasks/lead_tracker_use.mdx",
    
    # air_admin
    "air_admin/manage_your_practice/practice_settings.mdx",
    "air_admin/manage_your_practice/appointment_types.mdx",
    "air_admin/manage_your_practice/chart_note_templates.mdx",
    "air_admin/manage_your_practice/patient_workflows.mdx",
    "air_admin/manage_your_practice/provider_settings.mdx",
    "air_admin/manage_your_practice/provider_credentials.mdx",
    "air_admin/manage_your_practice/calendar_settings.mdx",
    "air_admin/manage_your_practice/register_providers_rx.mdx",
    "air_admin/manage_your_practice/fax_admin.mdx",
    "air_admin/analyze_your_reports/kpi_dashboard.mdx",
    "air_admin/analyze_your_reports/all_reports.mdx",
    
    # insights_onboard
    "insights_onboard/insights/insights_landing.mdx",
    
    # master_blogs
    "master_blogs/product_release.mdx",
    "master_blogs/customer_stories.mdx",
    "master_blogs/kx_modifier.mdx",
    "master_blogs/lead_tracker.mdx",
    "master_blogs/new_calendar.mdx",
    "master_blogs/agents_center.mdx",
    "master_blogs/ai_assistant.mdx",
    
    # master_changelogs
    "master_changelogs/changelog.mdx",
]

def get_image_folder_for_mdx(mdx_path):
    """Get the corresponding image folder for an MDX file."""
    # Extract path without extension
    mdx_path_obj = Path(mdx_path)
    mdx_name = mdx_path_obj.stem  # filename without extension
    mdx_dir = mdx_path_obj.parent
    
    # The image folder should be at images/{parent_dir}/{mdx_name}/
    image_folder = IMAGES_DIR / mdx_dir / mdx_name
    return image_folder

def build_old_to_new_image_mapping(mdx_path):
    """Build a mapping of old image paths to new image paths for a specific MDX file."""
    image_folder = get_image_folder_for_mdx(mdx_path)
    mapping = {}
    
    if image_folder.exists():
        # Get all images in this folder
        for img_file in image_folder.iterdir():
            if img_file.is_file():
                # The new path relative to /images/
                new_path = str(img_file.relative_to(IMAGES_DIR))
                
                # Try to extract the original filename
                # Format is {mdx_name}_{number}.{ext}
                match = re.match(r'.+_(\d+)(\.\w+)$', img_file.name)
                if match:
                    # We need to find what the old path was
                    # This is complex because we don't have reverse mapping
                    # For now, we'll just use the image name as-is
                    pass
                
                # For simplicity, map the stem back to the new path
                # This won't be perfect but will help with common patterns
                old_name = img_file.name
                mapping[old_name] = new_path
    
    return mapping

def update_image_references_in_file(mdx_file_path):
    """Update all image references in an MDX file."""
    mdx_path = BASE_DIR / mdx_file_path
    
    if not mdx_path.exists():
        print(f"Warning: MDX file not found: {mdx_file_path}")
        return 0
    
    # Read the file
    with open(mdx_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_content = content
    
    # Get the image folder for this MDX
    image_folder = get_image_folder_for_mdx(mdx_file_path)
    image_folder_relative = str(image_folder.relative_to(IMAGES_DIR))
    
    # Simple replacement: update all /images/ references to point to the new structure
    # This is a simplification - we're just updating the path structure
    
    # For this MDX file, all images should now be in /images/{parent_dir}/{mdx_name}/
    # We need to replace old references like /images/old_image.ext
    # with /images/{parent_dir}/{mdx_name}/{mdx_name}_N.ext
    
    # Extract all current image references
    patterns = [
        (r'(!\[.*?\]\()(/images/[^)]+)(\))', lambda m: f"{m.group(1)}/images/{image_folder_relative}/{Path(m.group(2)).name}{m.group(3)}"),
        (r'(src=")(/images/[^"]+)(")', lambda m: f"{m.group(1)}/images/{image_folder_relative}/{Path(m.group(2)).name}{m.group(3)}"),
    ]
    
    changes = 0
    for pattern, replacement in patterns:
        matches = list(re.finditer(pattern, content))
        if matches:
            # Replace each match
            for match in reversed(matches):  # Reverse to maintain positions
                old_path = match.group(2)
                old_filename = Path(old_path).name
                
                # Check if a file with this name pattern exists in the new location
                potential_files = list(image_folder.glob(f"*{Path(old_filename).suffix}"))
                
                if potential_files:
                    # Use the first matching file
                    new_filename = potential_files[0].name
                    new_path = f"/images/{image_folder_relative}/{new_filename}"
                    
                    start, end = match.span()
                    old_ref = content[start:end]
                    new_ref = old_ref.replace(old_path, new_path)
                    content = content[:start] + new_ref + content[end:]
                    changes += 1
    
    # Write back if changes were made
    if content != original_content:
        with open(mdx_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return changes
    
    return 0

def main():
    print("Updating image references in MDX files...")
    print()
    
    total_changes = 0
    files_updated = 0
    
    for mdx_file in MDX_FILES:
        changes = update_image_references_in_file(mdx_file)
        if changes > 0:
            print(f"Updated {mdx_file}: {changes} image references")
            files_updated += 1
            total_changes += changes
    
    print()
    print(f"Update complete!")
    print(f"  Files updated: {files_updated}")
    print(f"  Total image references updated: {total_changes}")

if __name__ == "__main__":
    main()
