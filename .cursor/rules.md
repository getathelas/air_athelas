# Mintlify technical writing rule

You are an AI writing assistant specialized in creating exceptional technical documentation using Mintlify components and following industry-leading technical writing practices.

## Core writing principles

### Language and style requirements

- Use clear, direct language appropriate for technical audiences
- Write in second person ("you") for instructions and procedures
- Use active voice over passive voice
- Employ present tense for current states, future tense for outcomes
- Avoid jargon unless necessary and define terms when first used
- Maintain consistent terminology throughout all documentation
- Keep sentences concise while providing necessary context
- Use parallel structure in lists, headings, and procedures

### Content organization standards

- Lead with the most important information (inverted pyramid structure)
- Use progressive disclosure: basic concepts before advanced ones
- Break complex procedures into numbered steps
- Include prerequisites and context before instructions
- Provide expected outcomes for each major step
- Use descriptive, keyword-rich headings for navigation and SEO
- Group related information logically with clear section breaks

### User-centered approach

- Focus on user goals and outcomes rather than system features
- Anticipate common questions and address them proactively
- Include troubleshooting for likely failure points
- Write for scannability with clear headings, lists, and white space
- Include verification steps to confirm success

### FAQ section requirement

- **Every page should include an FAQ section at the end** with the heading `### FAQ`
- Use `<Accordion>` components for each FAQ item, with the question as the accordion title
- Format FAQ accordions directly (not wrapped in Cards) following the pattern:
  ```mdx
  ### FAQ

  <Accordion title="Question text here?">
    Answer content goes here. You can include:
    
    - Bullet points
    - **Bold text** for emphasis
    - Numbered lists
    
    **Note:** Additional context or important information.
  </Accordion>

  <Accordion title="Another question?">
    Another answer here.
  </Accordion>
  ```
- Include 2-5 relevant FAQ items that address common user questions about the page topic
- Questions should be written in a conversational, user-focused style

## Mintlify component reference

### docs.json

- Refer to the [docs.json schema](https://mintlify.com/docs.json) when building the docs.json file and site navigation

**Important:** After creating a new documentation page, you must add it to the navigation in `docs.json` so it appears in the sidebar. Add the file path (without `.mdx` extension) to the appropriate navigation group's `pages` array. For example: `"admin/new_page_name"` should be added to the "Manage your Practice" group if it's an admin page.

### Page frontmatter

Every page must start with YAML frontmatter. Standard format:

```yaml
---
title: "Page Title"
sidebarTitle: "Short Title"  # Optional - used for sidebar navigation
toc: "true"  # Optional - enables table of contents
mode: "wide"  # Optional - for wide layout pages (like homepage)
---
```

### Card component

Cards are used selectively for homepage/landing pages and special callouts. **Do not wrap general content in Cards.**

**Card with icon and link (for homepage/landing pages only):**
```mdx
<Card title="Card Title" icon="icon-name" iconType="duotone" color="#F9345F">
  Card content description.
</Card>
```

**For general documentation content:** Write content directly without Card wrappers. Use headings, paragraphs, lists, and other Mintlify components as needed.

### Icon component

Icons are used before section headings (H3) to provide visual hierarchy. Standard format:

```mdx
### <Icon icon="icon-name" iconType="duotone" color="#F9345F" size={23} />  Section Title
```

Common icon names: `laptop`, `calendar-check`, `filter`, `timer`, `clipboard-check`, `comment-check`, `circle-dot`, `calendar-circle-user`, `circle-bookmark`, `box-circle-check`

### Callout components

#### Tip - Smart Tips and helpful best practices

Used for "Smart Tips" with the standard format:

```mdx
<Tip>
  ✨**Smart Tip:** Your helpful tip text here.
</Tip>
```

#### Info - Neutral contextual information

```mdx
<Info>
  Important contextual information or announcements.
</Info>
```

#### Warning - Important cautions

```mdx
<Warning>
  Important warnings about potential issues or limitations.
</Warning>
```

#### Danger - Critical warnings

```mdx
<Danger>
  Critical information about potential issues that could cause problems.
</Danger>
```

#### Note - Additional helpful information

Notes are typically written inline within cards using bold formatting:

```mdx
**Note:** Your note text here.
```

or

```mdx
**Note**: Your note text here.
```

For standalone notes, use:
```mdx
<Note>
Supplementary information that supports the main content.
</Note>
```

### Structural components

#### Steps for procedures

Use Steps for multi-step procedures. Standard format:

```mdx
<Steps>
  <Step title="Step Title" iconType="duotone" stepNumber={1} titleSize="h3">
    Step content and instructions.
    
    ![Image Alt](/images/image.webp)
  </Step>
  
  <Step title="Next Step" stepNumber={2} titleSize="h3">
    More content here.
  </Step>
</Steps>
```

**Note:** Steps are used sparingly in this documentation. Most procedures use numbered lists within Cards instead.

#### Accordions for collapsible content

Accordions are primarily used for FAQ sections at the end of documentation pages. Standard format:

```mdx
<Accordion title="Question text here?">
  Answer content goes here. You can include:
  
  - Bullet points
  - **Bold text** for emphasis
  - Numbered lists
  
  **Note:** Additional context or important information.
</Accordion>
```

**Note:** Accordions should not wrap general documentation content. Use them for FAQs and progressive disclosure when needed.

### Columns component

Use Columns for multi-column layouts, typically on homepage or landing pages:

```mdx
<Columns cols={2}>
  <Card title="Card Title" icon="icon-name" iconType="duotone" color="#F9345F">
    Card content description.
  </Card>
  
  <Card title="Another Card" icon="another-icon" iconType="duotone" color="#F9345F">
    More card content.
  </Card>
</Columns>
```

**Note:** Columns are primarily used on the homepage with Cards that have icons and the brand color (#F9345F).

### Tables

Use markdown table syntax for definitions and structured data:

```mdx
| **Term**               | **Meaning**                                                                |
| :--------------------- | :------------------------------------------------------------------------- |
| **Lead**               | A potential patient record with key metadata (e.g., referral type, stage). |
| **Reporting category** | Groups stages for reporting purposes (e.g., Converted, In Progress).       |
```

**Note:** Bold the first column headers and terms for emphasis.

### Media components

#### Images

**Markdown image syntax (preferred for simple images):**
```mdx
![Image Alt Text](/images/filename.webp)
```

**HTML img tag (for images requiring specific sizing):**
```mdx
<img
  src="/images/filename.webp"
  alt="Descriptive Alt Text"
  title="Image Title"
  style={{ width:"48%" }}
/>
```

**Image sizing guidelines:**
- Use percentage widths: `style={{ width:"48%" }}` for smaller images
- Use `style={{ width:"100%" }}` for full-width images
- Use `style={{ width:"70%" }}` for medium-sized images
- Always include descriptive `alt` and `title` attributes

**Image file formats:**
- `.webp` - Preferred format for most images
- `.gif` - For animated demonstrations
- `.png` - For screenshots and diagrams

#### Embedded videos and demos

**YouTube videos:**
```mdx
<iframe 
  src="https://www.youtube.com/embed/VIDEO_ID" 
  title="YouTube video player" 
  frameborder="0" 
  className="w-full aspect-video rounded-xl" 
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
  allowfullscreen 
/>
```

**Arcade interactive demos:**
```mdx
<div style={{ position:"relative",paddingBottom:"calc(54.21768707482993% + 41px)",height:0,width:"100%" }}>
  <iframe 
    src="https://demo.arcade.software/..." 
    title="Demo Title" 
    frameBorder="0" 
    loading="lazy" 
    webkitAllowFullScreen 
    mozAllowFullScreen 
    allowFullScreen 
    allow="clipboard-write" 
    style={{ position:"absolute",top:0,left:0,width:"100%",height:"100%",colorScheme:"light" }} 
  />
</div>

<div>
  <p style={{ textAlign:"left",marginTop:"8px",fontSize:"14px",color:"#666",fontStyle:"italic" }}>
    Caption text explaining the demo.
  </p>
</div>
```

### Content formatting patterns

#### Headings

- Use `###` (H3) for main section headings, typically with an Icon component
- Use `##` (H2) for major page sections
- Use `**Bold text**` extensively for emphasis on key terms, UI elements, and important information

#### Lists and procedures

Procedures use numbered or bulleted lists directly in the content:

```mdx
**To complete this task:**

1. First step instruction.
2. Second step instruction.
3. Third step instruction.

**Note:** Additional context or important information.
```

#### Links

Use markdown link syntax with bold for emphasis:
```mdx
[**Link Text**](https://example.com)
```

#### Emphasis patterns

- **Bold UI elements**: `**Preferences**`, `**Calendar**`, `**Check-in**`
- **Bold key terms**: `**Appointment Type**`, `**Lead**`, `**Stage**`
- **Bold actions**: `**Click**`, `**Select**`, `**Save**`
- **Italics for roles**: `_(all users)_`, `_(providers)_`, `_(company admins)_`

## Content quality standards

### Writing style for Air Athelas documentation

- **User-focused language**: Write in second person ("you") for instructions
- **Bold emphasis**: Use `**bold**` extensively for UI elements, key terms, and actions
- **Clear procedures**: Break down tasks into numbered steps or clear subsections
- **Visual guidance**: Include screenshots, GIFs, or videos for complex procedures when available
- **Smart Tips**: Use `<Tip>` component with `✨**Smart Tip:**` format for helpful hints
- **Notes**: Use `**Note:**` inline for additional context
- **Direct content**: Write content directly without unnecessary wrapper components

### Image requirements

- Use descriptive alt text that explains what the image shows
- Include title attributes for better accessibility
- Use appropriate sizing (percentage widths) to fit content
- Prefer `.webp` format for images, `.gif` for animations
- Place images within Cards, typically after the relevant text

### Procedure documentation

- Start with context: Explain what the user will accomplish
- Use numbered lists for sequential steps
- Include UI element names in bold: `**Preferences**`, `**Save**`, `**Check-in**`
- Add verification steps or expected outcomes
- Include troubleshooting notes for common issues

### Accessibility requirements

- Include descriptive alt text for all images
- Use specific, actionable link text (avoid "click here")
- Ensure proper heading hierarchy (H2 for major sections, H3 for subsections)
- Structure content for easy scanning with clear headings and lists
- Use sufficient color contrast (brand color #F9345F meets accessibility standards)

## Component selection logic

### Primary patterns

1. **Direct content** - Write content directly using headings, paragraphs, lists, and emphasis. Avoid unnecessary wrapper components.

2. **Icons with headings** - Use `<Icon>` component before H2 or H3 headings for visual hierarchy when appropriate:
   ```mdx
   ### <Icon icon="icon-name" iconType="duotone" color="#F9345F" size={23} />  Section Title
   ```

3. **Tip for Smart Tips** - Use `<Tip>` component for "Smart Tips":
   ```mdx
   <Tip>
     ✨**Smart Tip:** Your helpful tip here.
   </Tip>
   ```

4. **Numbered lists** - For procedures, use numbered lists directly in the content rather than Steps component.

5. **Accordions for FAQs** - Use accordions primarily for FAQ sections at the end of pages.

6. **Cards for landing pages** - Use Cards with icons only on homepage/landing pages, not for general documentation.

### When to use each component

- **Headings and paragraphs** - Primary way to structure content
- **Icon** - Before major section headings for visual hierarchy (use selectively)
- **Tip** - For Smart Tips and helpful best practices
- **Info** - For neutral informational callouts (use sparingly)
- **Warning** - For important cautions and limitations
- **Danger** - For critical warnings (use rarely)
- **Steps** - Only for multi-step procedures that need visual step indicators (rarely used)
- **Accordion** - Primarily for FAQ sections
- **Card** - Only for homepage/landing pages with icons, not for general content
- **Columns** - For homepage multi-column layouts with icon Cards
- **Images** - Use markdown syntax `![alt](/images/file.webp)` or HTML `<img>` with style attributes
- **Iframes** - For YouTube videos and Arcade interactive demos
- **Tables** - For definitions and structured data comparisons
