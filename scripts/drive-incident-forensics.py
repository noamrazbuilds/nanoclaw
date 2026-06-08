#!/usr/bin/env python3
"""
drive-incident-forensics.py — pull Google's authoritative Drive Activity log for
the two sheets that vanished, to determine WHO deleted them and WHEN.

This answers the question NanoClaw's own logs cannot: the Drive Activity API
records every action (create/edit/delete/trash/restore) with the actor +
timestamp, independent of NanoClaw. It needs the `drive.activity.readonly`
OAuth scope (added during the post-incident gws re-consent).

Run AFTER re-consenting gws with the activity scope:
  python3 scripts/drive-incident-forensics.py

Reads OAuth from ~/.config/gws/credentials.json (refresh-token flow). Prints,
for each sheet, the full activity timeline with actors — the delete event names
the responsible actor (a user account, or an app/service).
"""
import json, urllib.request, urllib.parse, urllib.error, sys

CREDS = '/home/nanoclaw/.config/gws/credentials.json'
SHEETS = [
    ('QUOTE-LOG (daily-update)', '1-qkRJDMVIY-50cIZ7OQeiYIbHpHumL6g-JbmC1XHzLI'),
    ('CONCERT-ORIGINAL (pre-recovery)', '1AhHaWKxX3FINslVcy7wxZw9fZ5Wo2xbcT_JG_q77WKE'),
]

def token():
    c = json.load(open(CREDS))
    data = urllib.parse.urlencode({
        'client_id': c['client_id'], 'client_secret': c['client_secret'],
        'refresh_token': c['refresh_token'], 'grant_type': 'refresh_token',
    }).encode()
    r = urllib.request.urlopen(urllib.request.Request(
        'https://oauth2.googleapis.com/token', data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'}), timeout=20)
    return json.load(r)['access_token']

def activity(tok, sid):
    body = json.dumps({'itemName': f'items/{sid}', 'pageSize': 50}).encode()
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            'https://driveactivity.googleapis.com/v2/activity:query', data=body,
            headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'}), timeout=30)
        return json.load(r)
    except urllib.error.HTTPError as e:
        return {'error': e.read().decode()[:400]}

def describe(a):
    ts = a.get('timestamp', a.get('timeRange', {}).get('endTime', '?'))[:19]
    actions = []
    for ac in a.get('actions', []):
        d = ac.get('detail', {})
        actions += list(d.keys())
    actors = []
    for ac in a.get('actors', []):
        if 'user' in ac:
            u = ac['user']
            who = u.get('knownUser', {}).get('personName') or u.get('deletedUser') and 'deleted-user' or 'unknown-user'
            actors.append(f'user:{who}')
        elif 'impersonation' in ac:
            actors.append('impersonation')
        elif 'system' in ac:
            actors.append('system:' + ac['system'].get('type', '?'))
        elif 'administrator' in ac:
            actors.append('administrator')
        else:
            actors.append(list(ac.keys())[0] if ac else '?')
    return ts, actions, actors

def main():
    try:
        tok = token()
    except Exception as e:
        print('TOKEN exchange failed:', e); sys.exit(1)
    for label, sid in SHEETS:
        print(f'\n=== {label} ===\n    {sid}')
        d = activity(tok, sid)
        if 'error' in d:
            err = d['error']
            if 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' in err or 'insufficient' in err.lower():
                print('    ⚠ drive.activity.readonly scope NOT present — re-consent gws first (see runbook).')
            else:
                print('    API error:', err[:250])
            continue
        acts = d.get('activities', [])
        print(f'    {len(acts)} activity record(s):')
        # newest first
        for a in acts:
            ts, actions, actors = describe(a)
            flag = '  <<< DELETE/TRASH' if any(k in ('delete', 'trash', 'remove', 'permanentDelete') for k in actions) else ''
            print(f'      {ts} | {actions} | {actors}{flag}')

if __name__ == '__main__':
    main()
