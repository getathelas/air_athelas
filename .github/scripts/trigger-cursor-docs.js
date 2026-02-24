

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const CURSOR_API_KEY = process.env.CURSOR_API_KEY;
const REPO = 'getathelas/air_athelas';
const REVIEWER = 'sean0x09';

async function getLinearTickets() {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': LINEAR_API_KEY,
      'Content-Type': 'application/json'
    },
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
5. Open a pull request when done, request review from GitHub user: ${REVIEWER}

## Source material
Linear ticket: ${ticket.url}
Feature name: ${ticket.title}

Feature description (written by PM):
${ticket.description}

## Requirements
- Branch name: ${branchName}
- PR title: docs: ${ticket.title} [${ticket.identifier}]
- PR description must link back to: ${ticket.url}
- Follow ALL conventions in .cursor/rules/docs-writer.mdc exactly.
`;

  const res = await fetch('https://api.cursor.com/aiserver/v1/cloud-agent/tasks', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CURSOR_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      repository: REPO,
      branch: branchName,
      task,
      autoCreatePR: true
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cursor API error: ${res.status} - ${err}`);
  }

  return await res.json();
}

async function markTicketInProgress(ticketId) {
  const stateRes = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': LINEAR_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `{ workflowStates(filter: { type: { eq: "started" } }) { nodes { id name } } }`
    })
  });
  const stateData = await stateRes.json();
  const inProgressState = stateData.data.workflowStates.nodes[0];

  await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': LINEAR_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `mutation { issueUpdate(id: "${ticketId}", input: { stateId: "${inProgressState.id}" }) { success } }`
    })
  });
}

async function main() {
  console.log('Checking Linear for cursor-docs tickets...');
  const tickets = await getLinearTickets();
  console.log(`Found ${tickets.length} ticket(s)`);

  for (const ticket of tickets) {
    console.log(`Processing: ${ticket.identifier} - ${ticket.title}`);
    if (!ticket.description || ticket.description.trim().length < 50) {
      console.log(`  ⚠️  Description too short or empty, skipping`);
      continue;
    }
    const result = await triggerCursorAgent(ticket);
    console.log(`  ✅ Agent task created:`, result);
    await markTicketInProgress(ticket.id);
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });