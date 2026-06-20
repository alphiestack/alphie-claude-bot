// ONE-TIME LOCAL SCRIPT — run this yourself, once, on your own machine.
// It will open a browser, ask you to log in to your personal Google account,
// and print a refresh token you'll save as a GitHub Secret.
//
// Usage:
//   npm install googleapis open
//   node get-refresh-token.js
//
// You'll need a client_id and client_secret from Google Cloud Console
// (OAuth Client ID, type "Desktop app"). Set as env vars or paste below.

const { google } = require('googleapis');
const http = require('http');
const openModule = require('open');
const open = openModule.default || openModule;
const url = require('url');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'PASTE_YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'PASTE_YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send', // needed to send the digest email
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];

async function main() {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh token
    scope: SCOPES,
    prompt: 'consent', // forces refresh token to be returned even on repeat runs
  });

  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/oauth2callback')) {
      const qs = new url.URL(req.url, REDIRECT_URI).searchParams;
      const code = qs.get('code');
      res.end('Success! You can close this tab and return to your terminal.');
      server.close();

      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n=== SAVE THIS REFRESH TOKEN AS A GITHUB SECRET (GOOGLE_REFRESH_TOKEN) ===\n');
      console.log(tokens.refresh_token);
      console.log('\n===========================================================================\n');
      if (!tokens.refresh_token) {
        console.log('No refresh token returned. Revoke prior access at https://myaccount.google.com/permissions and re-run this script.');
      }
      process.exit(0);
    }
  });

  server.listen(3000, () => {
    console.log('Opening browser for Google login...');
    open(authUrl);
  });
}

main();
