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
  const match = description.match(/https:\/\/www\.notion\.so\/[^\s\)]+/);
  return match ? match[0] : null;
}

async function getLinearTickets() {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Authorization': LINEAR_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{
        issues(filter: {
          labels: { name: { eq: "cursor-docs" } }
          state: { type: { eq: "unstarted" } }
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
    .slice(0, 50)}`;

  const task = `
You are writing external user-facing documentation for the Athelas Air/Insights help site.

## Your instructions (do these in order, do not skip any step)

1. READ the file .cursor/rules/docs-writer.mdc in this repository. This contains all the rules you must follow for folder structure, file naming, MDX format, image handling, and docs.json navigation. Do not write a single file until you have read it.

2. Fetch the Notion page at this URL: ${notionUrl}
   - Extract all text content, headings, and structure from the page.
   - Download every image on the page and save them locally as .webp files in the correct images/ folder (the path must mirror the MDX file path exactly, as described in the rules file).
   - Do not reference images as external URLs — they must be committed to the repo.

3. Write a new MDX documentation page based on the Notion content, following the rules file exactly for:
   - Correct folder and file path based on the product and role this feature belongs to
   - Correct MDX frontmatter fields
   - Correct image references pointing to the locally saved images

4. Update docs.json to add the new page to the correct navigation section. Infer the right placement from the feature's product (Air or Insights) and role (provider, front desk, admin, biller).

5. Commit all changes and push to the branch. Do not attempt to open a PR.

## Context
Linear ticket: ${ticket.url}
Feature name: ${ticket.title}
Notion source: ${notionUrl}

## Branch
Use branch name: ${branchName}
`;

  const res = await fetch('https://api.cursor.com/v0/agents', {
    method: 'POST',
    headers: cursorAuth(),
    body: JSON.stringify({
      prompt: { text: task },
      source: { repository: REPO, ref: 'main' },
      target: {
        branchName: branchName,
        autoCreatePr: false
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cursor API error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  return { ...data, branchName };
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
    if (agent.status === 'FINISHED') return agent;
    if (agent.status === 'FAILED') throw new Error(`Agent ${agentId} failed`);
  }
  throw new Error('Agent timed out after 20 minutes');
}

async function createPR(branchName, ticket, notionUrl) {
  await new Promise(r => setTimeout(r, 5000));

  const prRes = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: `docs: ${ticket.title} [${ticket.identifier}]`,
      body: `Auto-generated documentation via Cursor Cloud Agent.\n\n**Linear ticket:** ${ticket.url}\n**Notion source:** ${notionUrl}`,
      head: branchName,
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
  console.log('Checking Linear for cursor-docs tickets...');
  const tickets = await getLinearTickets();
  console.log(`Found ${tickets.length} ticket(s)`);

  for (const ticket of tickets) {
    console.log(`\nProcessing: ${ticket.identifier} - ${ticket.title}`);

    const notionUrl = extractNotionUrl(ticket.description);
    if (!notionUrl) {
      console.log(`  ⚠️  No Notion URL found in description, skipping`);
      continue;
    }
    console.log(`  Notion URL: ${notionUrl}`);

    console.log(`  Triggering Cursor agent...`);
    const agent = await triggerCursorAgent(ticket, notionUrl);
    console.log(`  Agent created: ${agent.target?.url || agent.id}`);

    await markTicketInProgress(ticket.id);

    console.log(`  Waiting for agent to finish...`);
    await waitForAgent(agent.id);

    console.log(`  Creating PR...`);
    await createPR(agent.branchName, ticket, notionUrl);
  }

  console.log('\nAll done.');
}

main().catch(err => { console.error(err); process.exit(1); });