// meeting-prep.js
// Runs on a schedule (via GitHub Actions). For each meeting in the next
// LOOKAHEAD_HOURS, finds related emails and Drive files, asks Claude to write
// a prep brief, and emails the combined digest to yourself via Gmail.

const { google } = require('googleapis');
const fs = require('fs');

// ---- Config ----
const LOOKAHEAD_HOURS = 24; // meetings in the next 24h; adjust as needed
const OUTPUT_FILE = 'meeting-prep-output.md';

// ---- Env vars (set these as GitHub Secrets) ----
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  ANTHROPIC_AUTH_TOKEN,
  ANTHROPIC_BASE_URL,
  MY_EMAIL, // the Gmail address to send the digest to (your own)
} = process.env;

function getOAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}

async function getUpcomingEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const later = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: later.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return res.data.items || [];
}

async function getRelatedEmails(auth, attendeeEmails) {
  if (!attendeeEmails.length) return [];
  const gmail = google.gmail({ version: 'v1', auth });

  const query = attendeeEmails.map((e) => `from:${e} OR to:${e}`).join(' OR ');
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: `(${query}) newer_than:30d`,
    maxResults: 5,
  });

  const messages = res.data.messages || [];
  const fullMessages = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });
    const headers = full.data.payload.headers;
    const subject = headers.find((h) => h.name === 'Subject')?.value || '(no subject)';
    const from = headers.find((h) => h.name === 'From')?.value || '';
    const snippet = full.data.snippet || '';
    fullMessages.push({ subject, from, snippet });
  }

  return fullMessages;
}

async function getRelatedDriveFiles(auth, keywords) {
  if (!keywords) return [];
  const drive = google.drive({ version: 'v3', auth });

  // Search Drive for files whose name matches keywords from the event title
  const res = await drive.files.list({
    q: `name contains '${keywords.replace(/'/g, "")}' and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 3,
  });

  const files = res.data.files || [];
  const results = [];

  for (const file of files) {
    let textContent = '';
    try {
      if (file.mimeType === 'application/vnd.google-apps.document') {
        const exportRes = await drive.files.export(
          { fileId: file.id, mimeType: 'text/plain' },
          { responseType: 'text' }
        );
        textContent = exportRes.data.slice(0, 1500); // cap length
      } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
        const sheets = google.sheets({ version: 'v4', auth });
        const valuesRes = await sheets.spreadsheets.values.get({
          spreadsheetId: file.id,
          range: 'A1:E20', // first chunk of the sheet
        });
        textContent = JSON.stringify(valuesRes.data.values || []).slice(0, 1500);
      }
    } catch (err) {
      console.log(`Could not read file ${file.name}: ${err.message}`);
    }
    results.push({ name: file.name, content: textContent });
  }

  return results;
}

async function summarizeWithClaude(event, emails, driveFiles) {
  const attendees = (event.attendees || []).map((a) => a.email).join(', ');

  const prompt = `I have an upcoming meeting. Write a short, practical prep brief (under 200 words).

Meeting: ${event.summary || '(no title)'}
Time: ${event.start?.dateTime || event.start?.date}
Attendees: ${attendees || 'none listed'}
Description: ${event.description || 'none'}

Related recent emails:
${emails.map((e) => `- From: ${e.from}\n  Subject: ${e.subject}\n  Snippet: ${e.snippet}`).join('\n') || 'No related emails found.'}

Related Drive documents:
${driveFiles.map((f) => `- ${f.name}:\n  ${f.content}`).join('\n') || 'No related documents found.'}

Summarize what I need to know going into this meeting: context, open questions, anything I should follow up on.`;

  const response = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_AUTH_TOKEN,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.content.map((c) => c.text || '').join('\n');
}

function buildRawEmail({ to, subject, body }) {
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    body,
  ];
  const message = messageParts.join('\n');
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendDigestEmail(auth, digestText) {
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawEmail({
    to: MY_EMAIL,
    subject: `Meeting Prep Digest — ${new Date().toLocaleDateString()}`,
    body: digestText,
  });

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
}

async function main() {
  const auth = getOAuthClient();
  const events = await getUpcomingEvents(auth);

  if (!events.length) {
    console.log('No upcoming meetings in window.');
    return;
  }

  let combinedOutput = `# Meeting Prep — ${new Date().toLocaleString()}\n\n`;

  for (const event of events) {
    const attendeeEmails = (event.attendees || [])
      .map((a) => a.email)
      .filter((e) => e && !e.includes('resource.calendar.google.com'));

    console.log(`Processing: ${event.summary}`);
    const emails = await getRelatedEmails(auth, attendeeEmails);
    const driveFiles = await getRelatedDriveFiles(auth, event.summary);
    const summary = await summarizeWithClaude(event, emails, driveFiles);

    combinedOutput += `## ${event.summary || '(no title)'}\n`;
    combinedOutput += `**Time:** ${event.start?.dateTime || event.start?.date}\n\n`;
    combinedOutput += `${summary}\n\n---\n\n`;
  }

  // Save to repo file (handy for history/debugging)
  fs.writeFileSync(OUTPUT_FILE, combinedOutput);
  console.log(`Saved to ${OUTPUT_FILE}`);

  // Email the digest to yourself
  await sendDigestEmail(auth, combinedOutput);
  console.log(`Digest emailed to ${MY_EMAIL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
