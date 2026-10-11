"""Read a separately trusted encrypted revocation ledger; never open social traffic.

Checkpoint SHA256 must come from the independent ledger operator, not the backup.
The checkpoint establishes byte integrity only, not completeness after a disaster.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from datetime import datetime

UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
HASH = re.compile(r'^[a-f0-9]{64}$')
KINDS = {'withdrawal', 'account_erasure', 'block', 'sanction', 'activity', 'routine', 'media', 'comment', 'message', 'relationship', 'invitation', 'source_workout', 'group', 'group_post', 'challenge', 'group_membership', 'messaging_optout', 'discovery_optout', 'reaction', 'challenge_membership', 'challenge_contribution', 'mute', 'mention_optout', 'comment_setting_optout', 'notification_optout'}
GENERATION_REQUIRED = {'withdrawal', 'activity', 'routine', 'media', 'comment', 'message', 'invitation', 'group_post', 'group_membership', 'messaging_optout', 'discovery_optout', 'challenge_membership', 'mute', 'mention_optout', 'comment_setting_optout', 'notification_optout'}
MAX_JOURNAL = 32 * 1024 * 1024


def private_bytes(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit or info.st_mode & 0o077 or info.st_uid != os.getuid():
            raise ValueError('Ledger file must be private and bounded')
        with os.fdopen(descriptor, 'rb', closefd=False) as source:
            return source.read(limit + 1)
    finally:
        os.close(descriptor)


def decrypt_age(ciphertext, identity):
    identity = Path(identity)
    private_bytes(identity, 16_384)
    result = subprocess.run(['age', '--decrypt', '--identity', str(identity)], input=ciphertext,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10, check=False,
                            env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C'})
    if result.returncode or len(result.stdout) > 16_384:
        raise ValueError('Ledger decryption failed')
    return result.stdout


def validate_event(event):
    if not isinstance(event, dict) or set(event) != {'event_id', 'user_id', 'kind', 'generation', 'target_id', 'related_user_id', 'created_at'}:
        raise ValueError('Invalid revocation event fields')
    if not UUID.fullmatch(str(event['event_id'])) or not UUID.fullmatch(str(event['user_id'])) or event['kind'] not in KINDS:
        raise ValueError('Invalid revocation event')
    if event['generation'] is not None and (type(event['generation']) is not int or not 1 <= event['generation'] <= 2_147_483_647):
        raise ValueError('Invalid revocation generation')
    for field in ('target_id', 'related_user_id'):
        if event[field] is not None and not UUID.fullmatch(str(event[field])):
            raise ValueError('Invalid revocation reference')
    if not isinstance(event['created_at'], str) or len(event['created_at']) > 64:
        raise ValueError('Invalid event timestamp')
    timestamp = datetime.fromisoformat(event['created_at'].replace('Z', '+00:00'))
    if timestamp.tzinfo is None:
        raise ValueError('Event timestamp requires offset')
    if (event['kind'] in GENERATION_REQUIRED and event['generation'] is None) or (event['kind'] != 'withdrawal' and event['target_id'] is None) or (event['kind'] in ('block', 'relationship', 'mute') and (event['related_user_id'] is None or event['related_user_id'] == event['user_id'])):
        raise ValueError('Invalid revocation scope')
    if (event['kind'] == 'mute' and event['target_id'] != event['related_user_id']) or (event['kind'] in ('mention_optout', 'comment_setting_optout', 'notification_optout') and event['related_user_id'] is not None) or (event['kind'] in ('mention_optout', 'notification_optout') and event['target_id'] != event['user_id']):
        raise ValueError('Invalid revocation scope')
    return event


def load_ledger(directory, checkpoint, identity, environment='dev', decrypt=decrypt_age):
    directory = Path(directory)
    if not directory.is_absolute() or directory != directory.resolve() or environment not in ('dev', 'production') or not HASH.fullmatch(checkpoint):
        raise ValueError('Explicit trusted ledger target required')
    for parent in (directory, *directory.parents):
        if parent.is_symlink():
            raise ValueError('Ledger path redirects')
    info = directory.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise ValueError('Private ledger directory required')
    journal = private_bytes(directory / 'journal.jsonl', MAX_JOURNAL)
    if hashlib.sha256(journal).hexdigest() != checkpoint or (journal and not journal.endswith(b'\n')):
        raise ValueError('Ledger checkpoint mismatch')
    previous = '0' * 64
    events = []
    seen = set()
    for sequence, line in enumerate(journal.splitlines(), 1):
        entry = json.loads(line)
        if not isinstance(entry, dict) or set(entry) != {'schema', 'environment', 'sequence', 'previous', 'eventId', 'hash', 'ciphertext'}:
            raise ValueError('Invalid ledger record')
        if entry['schema'] != 1 or entry['environment'] != environment or entry['sequence'] != sequence or entry['previous'] != previous:
            raise ValueError('Invalid ledger chain')
        if not UUID.fullmatch(str(entry['eventId'])) or entry['eventId'] in seen or not HASH.fullmatch(str(entry['hash'])) or not HASH.fullmatch(str(entry['ciphertext'])):
            raise ValueError('Invalid ledger identity')
        ciphertext = private_bytes(directory / (entry['eventId'] + '.age'), 128 * 1024)
        if hashlib.sha256(ciphertext).hexdigest() != entry['ciphertext']:
            raise ValueError('Ledger ciphertext mismatch')
        payload = decrypt(ciphertext, identity)
        if hashlib.sha256(payload).hexdigest() != entry['hash']:
            raise ValueError('Ledger plaintext mismatch')
        envelope = json.loads(payload)
        if not isinstance(envelope, dict) or set(envelope) != {'schema', 'environment', 'event'} or envelope['schema'] != 1 or envelope['environment'] != environment:
            raise ValueError('Ledger payload environment mismatch')
        event = validate_event(envelope['event'])
        if event['event_id'] != entry['eventId']:
            raise ValueError('Ledger event mismatch')
        events.append(event)
        seen.add(entry['eventId'])
        previous = hashlib.sha256(line).hexdigest()
    return events


def replay_sql(events, run_id):
    if not re.fullmatch(r'[a-f0-9]{32}', run_id) or not 0 < len(events) <= 100:
        raise ValueError('Invalid replay batch')
    events = [validate_event(event) for event in events]
    # Encode all untrusted JSON as hex; no interpolation of event strings into SQL.
    encoded = json.dumps(events, separators=(',', ':')).encode().hex()
    return ("set mizyun.restore_environment='dev';set mizyun.restore_run_id='" + run_id + "';\n"
            "select public.community_revocation_replay(convert_from(decode('" + encoded + "','hex'),'UTF8')::jsonb);\n").encode()
