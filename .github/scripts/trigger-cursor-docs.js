const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const CURSOR_API_KEY = process.env.CURSOR_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'getathelas/air_athelas';
const REVIEWER = 'sean0x09';

const cursorAuth = () => ({
  'Authorization': `Basic ${Buffer.from(`${CURSOR_API_KEY}:${CURSOR_API_KEY}`).toString('base64')}`,
  'Content-Type': 'application/json'
});

function extractNotionUrl(description) {
  if (!description) return null;
  // Handle plain URLs, markdown links [text](url), and angle-bracket links <url>
  // Stop at any markdown/bracket/quote chars
  const match = description.match(/https:\/\/(?:www\.)?notion\.so\/[^\s\)\]>"<]+/);
  if (!match) return null;
  // Strip any trailing punctuation that may have been captured
  const url = match[0].replace(/[.,;:!?\])"'>]+$/, '');
  console.log(`  Raw Notion URL extracted: ${url}`);
  return url;
}

async function getLinearTickets() {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Authorization': LINEAR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{
        issues(filter: {
          labels: { some: { name: { eq: "agent-docs" } } }
          state: { type: { in: ["unstarted", "todo"] } }
          assignee: { displayName: { eq: "seanshen" } }
        }) {
          nodes { id identifier title description url }
        }
      }`
    })
  });
  const data = await res.json();
  return data.data.issues.nodes;
}

async function triggerCursorAgent(ticket, notionUrl) {
  const branchName = `cursor-${ticket.identifier.toLowerCase()}-${ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/, '')
    .slice(0, 50)}`;

  const task = `
You are writing external user-facing documentation for the Athelas Air/Insights help site.

## FIRST THING: Read the rules file
The documentation rules file is located at the repo root: \`doc_writer.mdc\`
Read this file completely before doing anything else. It defines folder structure, file naming, MDX frontmatter, image handling, and docs.json navigation. Do not create any files until you have read it.

## Steps (in order)

1. Read \`doc_writer.mdc\` at the repo root.

2. Fetch the Notion page at this URL: ${notionUrl}
   - Extract all text, headings, and structure.
   - Download every image and save locally as .webp files in the correct images/ folder, mirroring the MDX file path exactly as described in the rules.
   - Do not use external image URLs — all images must be committed to the repo.

3. Write the new MDX documentation page following the rules exactly for folder path, file name, frontmatter, and image references.

4. Update docs.json to add the new page to the correct navigation section based on the feature's product (Air or Insights) and role (provider, front desk, admin, biller).

5. Create a summary file at \`_scratch/pr-summary.json\` with the following structure (fill in real values):
\`\`\`json
{
  "mdxFilePath": "the/full/path/to/created/file.mdx",
  "imagesFolder": "images/the/full/path/to/images/",
  "imageFiles": ["image1.webp", "image2.webp"],
  "navigationSection": "the section in docs.json where it was added",
  "pageTitle": "the title of the documentation page",
  "summary": "2-3 sentence description of what this page covers"
}
\`\`\`

6. Commit all changes including the summary file and push to the branch. Do not open a PR.

## Context
Linear ticket: ${ticket.url}
Feature name: ${ticket.title}
Notion source: ${notionUrl}
Branch: ${branchName}
`;

  const res = await fetch('https://api.cursor.com/v0/agents', {
    method: 'POST',
    headers: cursorAuth(),
    body: JSON.stringify({
      prompt: { text: task },
      source: { repository: REPO, ref: 'main' },
      target: { branchName, autoCreatePr: false }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cursor API error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  console.log(`  Cursor agent response: ${JSON.stringify(data)}`);
  // Use branch name from Cursor's response if available, else fall back to ours
  const resolvedBranch = data.target?.branchName || data.branchName || branchName;
  return { ...data, branchName: resolvedBranch };
}

async function waitForAgent(agentId) {
  console.log(`  Polling agent status every 30s (max 20 min)...`);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 30000));
    const res = await fetch(`https://api.cursor.com/v0/agents/${agentId}`, {
      headers: cursorAuth()
    });
    const agent = await res.json();
    console.log(`  [${(i + 1) * 30}s] Status: ${agent.status}`);
    if (agent.status === 'FINISHED') {
      console.log(`  Final agent data: ${JSON.stringify(agent)}`);
      return agent;
    }
    if (agent.status === 'FAILED') throw new Error(`Agent ${agentId} failed`);
  }
  throw new Error('Agent timed out after 20 minutes');
}

async function getBranchFromCursorOrGitHub(agentData, expectedBranchName, ticketIdentifier) {
  // 1. Try to get branch from Cursor's final agent response
  const cursorBranch = agentData.target?.branchName || agentData.branchName;
  if (cursorBranch && cursorBranch !== expectedBranchName) {
    console.log(`  Using branch from Cursor response: ${cursorBranch}`);
  }
  const candidateBranch = cursorBranch || expectedBranchName;

  // Give GitHub a moment to receive the push
  await new Promise(r => setTimeout(r, 8000));

  // 2. Check exact branch on GitHub
  const exactRes = await fetch(
    `https://api.github.com/repos/${REPO}/branches/${encodeURIComponent(candidateBranch)}`,
    { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` } }
  );
  if (exactRes.ok) {
    console.log(`  ✅ Branch confirmed on GitHub: ${candidateBranch}`);
    return candidateBranch;
  }

  // 3. List all recent branches and fuzzy-match on ticket identifier
  console.log(`  Branch "${candidateBranch}" not found, scanning all branches for ${ticketIdentifier}...`);
  let page = 1;
  while (page <= 5) {
    const listRes = await fetch(
      `https://api.github.com/repos/${REPO}/branches?per_page=100&page=${page}`,
      { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` } }
    );
    if (!listRes.ok) break;
    const branches = await listRes.json();
    if (branches.length === 0) break;
    const match = branches.find(b =>
      b.name.toLowerCase().includes(ticketIdentifier.toLowerCase())
    );
    if (match) {
      console.log(`  ✅ Branch found by ticket ID: ${match.name}`);
      return match.name;
    }
    page++;
  }

  throw new Error(
    `No GitHub branch found for ticket ${ticketIdentifier}.\n` +
    `Expected: ${candidateBranch}\n` +
    `The Cursor agent may have finished without committing any changes. ` +
    `Check the agent at: https://cursor.com/agents/${agentData.id}`
  );
}

async function fetchPRSummary(branchName) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/_scratch/pr-summary.json?ref=${encodeURIComponent(branchName)}`,
      { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildPRBody(ticket, notionUrl, summary) {
  if (summary) {
    const imageList = Array.isArray(summary.imageFiles) && summary.imageFiles.length
      ? summary.imageFiles.map(f => `\`${f}\``).join(', ')
      : 'none';

    return `## 📄 ${summary.pageTitle}

${summary.summary}

---

### What was created
| Field | Value |
|---|---|
| MDX file | \`${summary.mdxFilePath}\` |
| Images folder | \`${summary.imagesFolder}\` |
| Images committed | ${imageList} |
| Navigation section | ${summary.navigationSection} |

### References
- **Linear ticket:** ${ticket.url}
- **Notion source:** ${notionUrl}

---
*Auto-generated by Cursor Cloud Agent — review for accuracy before merging.*`;
  }

  return `Auto-generated documentation via Cursor Cloud Agent.\n\n**Linear ticket:** ${ticket.url}\n**Notion source:** ${notionUrl}`;
}

async function createPR(agentData, ticket, notionUrl) {
  const actualBranch = await getBranchFromCursorOrGitHub(agentData, agentData.branchName, ticket.identifier);

  console.log(`  Fetching agent summary from branch: ${actualBranch}`);
  const summary = await fetchPRSummary(actualBranch);
  if (summary) {
    console.log(`  Summary found: ${summary.mdxFilePath}`);
  } else {
    console.log(`  No summary file found, using fallback PR body`);
  }

  const prRes = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: `docs: ${ticket.title} [${ticket.identifier}]`,
      body: buildPRBody(ticket, notionUrl, summary),
      head: actualBranch,
      base: 'main'
    })
  });

  const pr = await prRes.json();
  if (!prRes.ok) throw new Error(`GitHub PR error: ${prRes.status} - ${JSON.stringify(pr)}`);
  console.log(`  ✅ PR created: ${pr.html_url}`);

  await fetch(`https://api.github.com/repos/${REPO}/pulls/${pr.number}/requested_reviewers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reviewers: [REVIEWER] })
  });

  console.log(`  ✅ Review requested from ${REVIEWER}`);
  return pr;
}

async function markTicketInProgress(ticketId) {
  const stateRes = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Authorization': LINEAR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ workflowStates(filter: { type: { eq: "started" } }) { nodes { id name } } }`
    })
  });
  const stateData = await stateRes.json();
  const inProgressState = stateData.data.workflowStates.nodes[0];

  await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Authorization': LINEAR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation { issueUpdate(id: "${ticketId}", input: { stateId: "${inProgressState.id}" }) { success } }`
    })
  });
  console.log(`  ✅ Linear ticket marked in progress`);
}

async function main() {
  console.log('Checking Linear for agent-docs tickets assigned to Sean Shen...');
  const tickets = await getLinearTickets();
  console.log(`Found ${tickets.length} ticket(s)`);

  for (const ticket of tickets) {
    console.log(`\nProcessing: ${ticket.identifier} - ${ticket.title}`);

    const notionUrl = extractNotionUrl(ticket.description);
    if (!notionUrl) {
      console.log(`  ⚠️  No Notion URL found in description, skipping`);
      console.log(`  Description: ${ticket.description?.slice(0, 200)}`);
      continue;
    }
    console.log(`  Notion URL: ${notionUrl}`);

    console.log(`  Triggering Cursor agent...`);
    const agent = await triggerCursorAgent(ticket, notionUrl);
    console.log(`  Agent ID: ${agent.id}`);
    console.log(`  Agent URL: ${agent.target?.url || 'N/A'}`);
    console.log(`  Branch: ${agent.branchName}`);

    await markTicketInProgress(ticket.id);

    console.log(`  Waiting for agent to finish...`);
    const finishedAgent = await waitForAgent(agent.id);

    console.log(`  Creating PR...`);
    await createPR({ ...agent, ...finishedAgent, branchName: agent.branchName }, ticket, notionUrl);
  }

  console.log('\nAll done.');
}

main().catch(err => { console.error(err); process.exit(1); });