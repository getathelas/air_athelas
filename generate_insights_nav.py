#!/usr/bin/env python3
"""
Generate insights navigation structure for docs.json
"""

import json
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path("/Users/seanshen/Repo/air_athelas")

# Icon mapping for activity folders
ICON_MAP = {
    "analytics": "chart-column",
    "reports": "chart-column",
    "athelas_assistant": "robot",
    "front_office_payments": "credit-card",
    "general_billing": "file-invoice",
    "appointments": "calendar",
    "calendar": "calendar",
    "patient_communications": "envelope",
    "patient_demographics": "square-user",
    "patient_profiles": "square-user",
    "patient_responsibility": "dollar-sign",
    "patient_statements": "file-text",
    "claim_details": "file-invoice",
    "encounter_details": "notes-medical",
    "posting": "upload",
    "tasking": "list-check",
    "messaging": "envelope",
    "faxing": "fax",
    "utilities": "wrench",
    "agents_center": "users",
    "daily_operations": "briefcase",
    "chart_notes": "notes-medical",
    "medications": "pills",
    "ai_scribe_and_tooling": "wand-magic-sparkles",
    "my_practice": "gear",
    "reporting": "chart-column",
}

# Tag mapping
TAG_MAP = {
    "insights_biller": "Biller",
    "insights_front_desk": "Front Desk",
    "insights_admin": "Admin",
    "insights_provider": "Provider",
    "insights_onboard": None,
}

def get_group_name(activity_folder):
    """Convert folder name to readable group name."""
    return activity_folder.replace("_", " ").title()

def build_navigation():
    """Build navigation structure for insights."""
    groups_by_role = defaultdict(lambda: defaultdict(list))
    
    # Find all MDX files
    for role_folder in ["insights_biller", "insights_front_desk", "insights_admin", "insights_provider", "insights_onboard"]:
        role_path = BASE_DIR / role_folder
        if not role_path.exists():
            continue
        
        for mdx_file in role_path.rglob("*.mdx"):
            rel_path = mdx_file.relative_to(role_path)
            activity_folder = rel_path.parent.parts[0] if rel_path.parent.parts else ""
            mdx_name = rel_path.stem
            
            # Build page path (without .mdx)
            page_path = f"{role_folder}/{rel_path.parent / mdx_name}" if activity_folder else f"{role_folder}/{mdx_name}"
            page_path = str(page_path).replace("\\", "/")
            
            groups_by_role[role_folder][activity_folder].append(page_path)
    
    # Build navigation groups
    nav_groups = []
    
    # Onboard first
    if "insights_onboard" in groups_by_role:
        onboard_pages = []
        for activity, pages in groups_by_role["insights_onboard"].items():
            onboard_pages.extend(sorted(pages))
        
        if onboard_pages:
            nav_groups.append({
                "group": "Getting Started with Insights",
                "icon": "stars",
                "pages": sorted(onboard_pages)
            })
    
    # Then by role
    role_order = ["insights_biller", "insights_front_desk", "insights_admin", "insights_provider"]
    
    for role_folder in role_order:
        if role_folder not in groups_by_role:
            continue
        
        tag = TAG_MAP.get(role_folder)
        
        for activity_folder, pages in sorted(groups_by_role[role_folder].items()):
            if not activity_folder:  # Files directly in role folder
                continue
            
            group_name = get_group_name(activity_folder)
            icon = ICON_MAP.get(activity_folder, "file")
            
            group = {
                "group": group_name,
                "icon": icon,
                "pages": sorted(pages)
            }
            
            if tag:
                group["tag"] = tag
            
            nav_groups.append(group)
    
    return nav_groups

def main():
    nav_groups = build_navigation()
    
    # Print JSON structure
    print(json.dumps(nav_groups, indent=2))

if __name__ == "__main__":
    main()
