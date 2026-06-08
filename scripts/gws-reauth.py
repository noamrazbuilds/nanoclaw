#!/usr/bin/env python3
"""
gws-reauth.py — headless re-consent for the gws Google account on a fixed port.

`gws auth login` opens a browser on a RANDOM callback port, which SSH tunnels
can't reliably forward on a headless server. This helper uses a FIXED port
(8585) so a single `ssh -L 8585:localhost:8585` tunnel works, and lets us
request an EXACT scope set (post-incident downscope + forensics).

What it does:
  1. Reads the OAuth client (client_id/secret) from ~/.config/gws/client.json
  2. Prints a Google consent URL (redirect_uri=http://localhost:8585)
  3. Serves on :8585, captures the auth code, exchanges it for tokens
  4. Backs up the old credentials.json, writes a new one with the new
     refresh_token + scopes (same format gws / the forensics script read)

SCOPES (post-incident): drops full auth/drive → drive.readonly (removes the
agent's ability to delete/trash ANY Drive file at the token level) and adds
drive.activity.readonly (forensics). Keeps gmail.modify, spreadsheets, calendar,
documents, presentations, forms, chat, contacts.

USAGE (run in YOUR terminal, with the tunnel up):
  ssh -L 8585:localhost:8585 nanoclaw@<server>      # in one terminal / your laptop
  python3 scripts/gws-reauth.py                     # on the server
  # → open the printed URL in your browser, approve, done.
"""
import json, os, sys, urllib.parse, urllib.request, http.server, webbrowser

CONFIG_DIR = os.path.expanduser('~/.config/gws')
CLIENT = os.path.join(CONFIG_DIR, 'client.json')
CREDS = os.path.join(CONFIG_DIR, 'credentials.json')
PORT = 8585
REDIRECT = f'http://localhost:{PORT}'

SCOPES = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/presentations',
    'https://www.googleapis.com/auth/forms',
    'https://www.googleapis.com/auth/chat.messages',
    'https://www.googleapis.com/auth/contacts',
    'https://www.googleapis.com/auth/drive.readonly',          # was auth/drive — no delete/trash
    'https://www.googleapis.com/auth/drive.activity.readonly', # forensics
]

client = json.load(open(CLIENT))['installed']
CID, CSEC = client['client_id'], client['client_secret']
AUTH_URI = client.get('auth_uri', 'https://accounts.google.com/o/oauth2/v2/auth')
TOKEN_URI = client.get('token_uri', 'https://oauth2.googleapis.com/token')

auth_url = AUTH_URI + '?' + urllib.parse.urlencode({
    'client_id': CID, 'redirect_uri': REDIRECT, 'response_type': 'code',
    'scope': ' '.join(SCOPES), 'access_type': 'offline', 'prompt': 'consent',
})

print('\n1. Make sure you have an SSH tunnel:  ssh -L 8585:localhost:8585 nanoclaw@<server>')
print('2. Open this URL in your browser and approve:\n')
print(auth_url)
print('\nWaiting for the OAuth callback on :%d ...\n' % PORT)
try:
    webbrowser.open(auth_url)
except Exception:
    pass

code_holder = {}

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(q)
        if 'code' in params:
            code_holder['code'] = params['code'][0]
            self.send_response(200); self.end_headers()
            self.wfile.write(b'gws re-auth complete. You can close this tab and return to the terminal.')
        else:
            self.send_response(400); self.end_headers()
            self.wfile.write(b'No code in callback.')
    def log_message(self, *a):
        pass

httpd = http.server.HTTPServer(('localhost', PORT), H)
while 'code' not in code_holder:
    httpd.handle_request()

print('Got auth code; exchanging for tokens...')
data = urllib.parse.urlencode({
    'code': code_holder['code'], 'client_id': CID, 'client_secret': CSEC,
    'redirect_uri': REDIRECT, 'grant_type': 'authorization_code',
}).encode()
resp = json.load(urllib.request.urlopen(urllib.request.Request(
    TOKEN_URI, data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'}), timeout=30))

if 'refresh_token' not in resp:
    print('ERROR: no refresh_token returned. Re-run (the consent must show the permission screen; prompt=consent is set).')
    print('response keys:', list(resp.keys())); sys.exit(1)

# Back up old creds, write new in gws's format
if os.path.exists(CREDS):
    bak = CREDS + '.bak-prereauth'
    os.replace(CREDS, bak)
    print('backed up old credentials →', bak)

new = {
    'type': 'authorized_user',
    'client_id': CID,
    'client_secret': CSEC,
    'refresh_token': resp['refresh_token'],
    'token_type': resp.get('token_type', 'Bearer'),
    'scopes': SCOPES,
}
with open(CREDS, 'w') as f:
    json.dump(new, f, indent=2)
os.chmod(CREDS, 0o600)
print('\n✅ wrote new credentials.json with downscoped + activity scopes.')
print('   Next: tell Claude — it will run the forensics + point the gws proxy at this file.')
