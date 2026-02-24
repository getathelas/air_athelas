const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const CURSOR_API_KEY = process.env.CURSOR_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'getathelas/air_athelas';
const REVIEWER = 'sean0x09';

const cursorAuth = () => ({
  'Authorization': `Basic ${Buffer.from(`${CURSOR_API_KEY}:${CURSOR_API_KEY}`).toString('base64')}`,
  'Content-Type': 'application/json'
});

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

async function triggerCursorAgent(ticket) {
  const branchName = `cursor-${ticket.identifier.toLowerCase()}-${ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)}`;

  const task = `
You are writing external user-facing documentation for the Athelas Air/Insights help site.

## Steps
1. READ .cursor/rules/docs-writer.mdc before doing anything else.
2. Use the feature description below to write a new MDX documentation page.
3. Save any images as .webp in the correct images/ folder mirroring the MDX path.
4. Update docs.json to add the new page to the correct navigation section.
5. Commit all changes and push the branch. Do NOT attempt to create a PR — that will be handled separately.

## Source material
Linear ticket: ${ticket.url}
Feature name: ${ticket.title}

Feature description (written by PM):
${ticket.description}

## Requirements
- Branch name: ${branchName}
- Follow ALL conventions in .cursor/rules/docs-writer.mdc exactly.
`;

  const res = await fetch('https://api.cursor.com/v0/agents', {
    method: 'POST',
    headers: cursorAuth(),
    body: JSON.stringify({
      prompt: { text: task },
      source: { repository: REPO, ref: 'main' },
      target: {
        branchName: branchName,
        autoCreatePr: false  // we handle PR creation ourselves
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
  console.log(`  Polling agent ${agentId} (max 20 min)...`);

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 30000)); // wait 30s between polls

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

async function createPR(branchName, ticket) {
  // Small delay to make sure the branch is fully pushed
  await new Promise(r => setTimeout(r, 5000));

  const prRes = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: `docs: ${ticket.title} [${ticket.identifier}]`,
      body: `Auto-generated documentation via Cursor Cloud Agent.\n\nLinear ticket: ${ticket.url}`,
      head: branchName,
      base: 'main'
    })
  });

  const pr = await prRes.json();

  if (!prRes.ok) {
    throw new Error(`GitHub PR error: ${prRes.status} - ${JSON.stringify(pr)}`);
  }

  console.log(`  ✅ PR created: ${pr.html_url}`);

  // Request reviewer separately
  await fetch(`https://api.github.com/repos/${REPO}/pulls/${pr.number}/requested_reviewers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reviewers: [REVIEWER] })
  });

  console.log(`  ✅ Reviewer requested: ${REVIEWER}`);
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

    if (!ticket.description || ticket.description.trim().length < 50) {
      console.log(`  ⚠️  Description too short, skipping`);
      continue;
    }

    console.log(`  Triggering Cursor agent...`);
    const agent = await triggerCursorAgent(ticket);
    console.log(`  Agent created: ${agent.target?.url || agent.id}`);

    await markTicketInProgress(ticket.id);

    console.log(`  Waiting for agent to finish...`);
    await waitForAgent(agent.id);

    console.log(`  Creating PR...`);
    await createPR(agent.branchName, ticket);
  }

  console.log('\nAll done.');
}

main().catch(err => { console.error(err); process.exit(1); });