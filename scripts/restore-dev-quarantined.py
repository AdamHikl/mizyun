#!/usr/bin/env python3
"""Offline Dev archive integrity/restore/quarantine drill, NEVER a live restore.

Requires separately trusted ciphertext digest and archive/candidate SHAs.
No services, ports, bind mounts, reopen option, or restored configuration use.
Real archive/key use and Docker execution are coordinator/operator actions.
Stdlib tests use synthetic payloads and mocked Docker; no real secrets needed.

2026-10-01 sources: Docker none network driver; PostgreSQL17 pg_restore;
Python tarfile security guidance. Checksums establish integrity against the
supplied trusted digest, not journal completeness or source SQL trust.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import shutil
import stat
import subprocess
import tempfile
import time
import uuid

REPO = Path(__file__).resolve().parent.parent
SQL = REPO / 'scripts/sql/quarantine-community-restored-dev.sql'
IMAGE = 'supabase/postgres:17.6.1.136'
LABEL = 'com.mizyun.restore-quarantine'
PAYLOAD = frozenset(('database.dump', 'globals.sql', 'storage.tar.gz',
 'storage-files.sha256', 'storage-xattrs.txt', 'storage-acls.txt',
 'recovery-config.tar.gz', 'table-counts.tsv', 'metadata.txt',
 'container-images.tsv', 'migration-versions.txt', 'PAYLOAD_SHA256SUMS'))
MAX_BYTES = 4 * 1024**3
SHA = re.compile(r'^[a-f0-9]{40}$')
HASH = re.compile(r'^[a-f0-9]{64}$')


def run(args, *, data=None, source=None, output=None, timeout=180):
    # Do not inherit a remote Docker context, DB URL or credential environment.
    env = {'PATH': os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin'),
           'HOME': os.environ.get('HOME', '/tmp'), 'LANG': 'C'}
    if args[0] == 'docker':
        args = ['docker', '--host=unix:///var/run/docker.sock', *args[1:]]
    result = subprocess.run(args, input=data, stdin=source, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Quarantined restore command failed')
    return result.stdout if output is None else b''


def regular(path, limit=MAX_BYTES):
    path = Path(os.path.abspath(path))
    if path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode) or path.stat().st_size > limit:
        raise ValueError('Unsafe or oversized input file')
    return path


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024**2), b''):
            value.update(chunk)
    return value.hexdigest()


def checksums(text, allowed=None):
    result = {}
    for line in text.splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([^\r\n]+)', line)
        if not match or match[2] in result:
            raise ValueError('Invalid or duplicate checksum entry')
        name = match[2]
        if allowed is not None and name not in allowed:
            raise ValueError('Unexpected checksum file')
        result[name] = match[1]
    if allowed is not None and set(result) != set(allowed):
        raise ValueError('Incomplete checksum manifest')
    return result


def verify_archive(path, expected_hash):
    archive = regular(path)
    match = re.fullmatch(r'mizyun-dev-(\d{8}T\d{6}Z)\.tar\.gz\.age', archive.name)
    if not match or not HASH.fullmatch(expected_hash):
        raise ValueError('Dev archive identity required')
    datetime.datetime.strptime(match[1], '%Y%m%dT%H%M%SZ')
    if regular(archive.parent / 'COMPLETE', 100).read_text().strip() != match[1]:
        raise ValueError('Incomplete Dev archive')
    manifest = checksums(regular(archive.parent / 'SHA256SUMS', 512).read_text(), {archive.name})
    if manifest[archive.name] != expected_hash or digest(archive) != expected_hash:
        raise ValueError('Ciphertext integrity mismatch')
    return archive, match[1]


def extract(source, destination, *, payload=False):
    # Never tar.extract/extractall: reject links/devices/duplicates before writing,
    # discard archive ownership/modes, and enforce bounded regular members.
    import tarfile
    destination.mkdir(mode=0o700)
    seen, total = set(), 0
    with tarfile.open(source, 'r:gz') as archive:
        for entry in archive:
            raw = entry.name
            if raw.startswith('./'):
                raw = raw[2:]
            if raw in ('', '.') and entry.isdir():
                continue
            name = PurePosixPath(raw)
            if name.is_absolute() or '..' in name.parts or '\\' in raw or any(ord(c)<32 for c in raw):
                raise ValueError('Archive path escape')
            normalized = str(name)
            if normalized in seen or len(seen) >= 100_000:
                raise ValueError('Duplicate or excessive archive entries')
            seen.add(normalized)
            if not entry.isfile() and not entry.isdir():
                raise ValueError('Archive links and special files forbidden')
            if payload and (normalized not in PAYLOAD or not entry.isfile()):
                raise ValueError('Unexpected payload member')
            if not payload and (not name.parts or name.parts[0] != 'storage'):
                raise ValueError('Unexpected Storage member')
            total += entry.size
            if entry.size < 0 or total > MAX_BYTES:
                raise ValueError('Expanded archive exceeds limit')
            target = destination.joinpath(*name.parts)
            if entry.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with archive.extractfile(entry) as reader, target.open('xb') as writer:
                    os.chmod(target, 0o600)
                    shutil.copyfileobj(reader, writer, length=1024**2)
    if payload and seen != PAYLOAD:
        raise ValueError('Incomplete payload')
    return total


def validate_payload(directory, timestamp, expected_source):
    if not SHA.fullmatch(expected_source):
        raise ValueError('Expected archive source SHA required')
    manifest = checksums(regular(directory / 'PAYLOAD_SHA256SUMS', 16_384).read_text(), PAYLOAD - {'PAYLOAD_SHA256SUMS'})
    for name, expected in manifest.items():
        if digest(regular(directory / name)) != expected:
            raise ValueError('Payload integrity mismatch')
    fields = {}
    for line in regular(directory / 'metadata.txt', 4096).read_text().splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in fields:
            raise ValueError('Invalid metadata')
        fields[key] = value
    expected = {'created_at': timestamp, 'source_sha': expected_source,
        'database_container': 'mizyun-dev-db', 'environment': 'dev',
        'format_version': '1', 'community_restore_traffic': 'closed_until_revocation_reconciliation'}
    if fields != expected:
        raise ValueError('Wrong Dev archive metadata')


def validate_candidate(candidate, source):
    if not SHA.fullmatch(candidate) or not SHA.fullmatch(source):
        raise ValueError('Exact source and candidate SHAs required')
    if run(['git', '-C', str(REPO), 'rev-parse', 'HEAD']).decode().strip() != candidate:
        raise ValueError('Candidate checkout mismatch')
    if run(['git', '-c', 'core.fsmonitor=false', '-C', str(REPO), 'status', '--porcelain']).strip():
        raise ValueError('Candidate checkout must be pristine')
    run(['git', '-C', str(REPO), 'merge-base', '--is-ancestor', source, candidate])


def candidate_migrations(candidate, source, versions):
    validate_candidate(candidate, source)
    recorded = versions.splitlines()
    if not recorded or len(set(recorded)) != len(recorded) or any(not re.fullmatch(r'\d{14}', v) for v in recorded):
        raise ValueError('Invalid archive migration inventory')
    files = sorted((REPO / 'supabase/migrations').glob('*.sql'))
    mapped = {}
    for path in files:
        match = re.fullmatch(r'(\d{14})_[a-zA-Z0-9_]+\.sql', path.name)
        if not match or match[1] in mapped:
            raise ValueError('Invalid candidate migration inventory')
        mapped[match[1]] = regular(path)
    ordered = list(mapped)
    if sorted(recorded) != ordered[:len(recorded)]:
        raise ValueError('Archive migrations are not a candidate prefix')
    return [mapped[v] for v in ordered[len(recorded):]], ordered[-1]


def inspect_container(name, token):
    entries = json.loads(run(['docker', 'inspect', name]))
    if len(entries) != 1:
        raise ValueError('Disposable resource identity mismatch')
    entry = entries[0]
    if (entry.get('Name') != '/' + name or entry.get('Config', {}).get('Labels', {}).get(LABEL) != token
        or not re.fullmatch(r'[a-f0-9]{64}', entry.get('Id', ''))
        or entry.get('HostConfig', {}).get('NetworkMode') != 'none'
        or entry.get('HostConfig', {}).get('PortBindings')
        or entry.get('HostConfig', {}).get('Privileged')
        or entry.get('NetworkSettings', {}).get('Ports') not in ({}, None, {'5432/tcp': None})
        or any(m.get('Type') != 'tmpfs' for m in entry.get('Mounts', []))):
        raise ValueError('Disposable resource isolation mismatch')
    return entry['Id']


def restore_payload(directory, candidate, source, revocations=None):
    migrations, head = candidate_migrations(candidate, source, regular(directory / 'migration-versions.txt', 128_000).read_text())
    token = uuid.uuid4().hex
    name = 'mizyun-dev-quarantine-' + token
    if run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip():
        raise ValueError('Disposable name already exists')
    attempted = False
    result = None
    try:
        # tmpfs avoids implicit persistent PGDATA volumes and host filesystem access.
        attempted = True
        run(['docker', 'run', '-d', '--pull', 'never', '--name', name, '--label', LABEL + '=' + token,
             '--network', 'none', '--security-opt', 'no-new-privileges',
             '--pids-limit', '128', '--memory', '1g', '--cpus', '2',
             '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=768m',
             '--tmpfs', '/var/run/postgresql:rw,nosuid,size=16m',
             '--tmpfs', '/tmp:rw,nosuid,size=256m', '-e', 'POSTGRES_PASSWORD=quarantined-only', IMAGE])
        identifier = inspect_container(name, token)
        for attempt in range(60):
            try:
                # pg_isready alone may see the entrypoint's temporary init server.
                if b'PostgreSQL init process complete' not in run(['docker', 'logs', identifier], timeout=5):
                    raise RuntimeError('Disposable database initialization incomplete')
                run(['docker', 'exec', identifier, 'pg_isready', '-U', 'supabase_admin'], timeout=5)
                break
            except RuntimeError:
                if attempt == 59:
                    raise RuntimeError('Disposable database not ready')
                time.sleep(1)
        # Globals are trusted source SQL inside this disposable container only.
        # Existing roles are skipped, all other globals errors are fatal.
        globals_text = regular(directory / 'globals.sql', 16_000_000).read_text()
        globals_text = re.sub(r'^CREATE ROLE ("(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z0-9_$]*);$',
            lambda m: "DO $mizyun$ BEGIN CREATE ROLE " + m[1] + "; EXCEPTION WHEN duplicate_object THEN NULL; END $mizyun$;", globals_text, flags=re.MULTILINE)
        run(['docker', 'exec', '-i', identifier, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], data=globals_text.encode())
        run(['docker', 'exec', identifier, 'createdb', '-U', 'supabase_admin', 'mizyun_restore'])
        with regular(directory / 'database.dump').open('rb') as dump:
            # Streaming avoids trusting/restoring any archive-specified database name.
            run(['docker', 'exec', '-i', identifier, 'pg_restore', '-U', 'supabase_admin',
                '-d', 'mizyun_restore', '--no-owner', '--exit-on-error'], source=dump, output=subprocess.DEVNULL, timeout=300)
        counts = regular(directory / 'table-counts.tsv', 128_000).read_text().splitlines()
        inventory = []
        for line in counts:
            match = re.fullmatch(r'([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\t(\d+)', line)
            if not match:
                raise ValueError('Invalid table inventory')
            if match[1] in inventory:
                raise ValueError('Duplicate table inventory')
            inventory.append(match[1])
            count = run(['docker', 'exec', identifier, 'psql', '-X', '-U', 'supabase_admin', '-d', 'mizyun_restore', '-Atc', 'select count(*) from ' + match[1]]).decode().strip()
            if count != match[2]:
                raise ValueError('Restored table count mismatch')
        actual_tables = run(['docker', 'exec', identifier, 'psql', '-X', '-U', 'supabase_admin', '-d', 'mizyun_restore', '-Atc', "select quote_ident(schemaname)||'.'||quote_ident(relname) from pg_stat_user_tables order by 1"]).decode().splitlines()
        if not inventory or sorted(inventory) != actual_tables:
            raise ValueError('Restored table inventory mismatch')
        actual_versions = run(['docker', 'exec', identifier, 'psql', '-X', '-U', 'supabase_admin', '-d', 'mizyun_restore', '-Atc', 'select version from supabase_migrations.schema_migrations order by version']).decode().splitlines()
        if actual_versions != sorted(regular(directory / 'migration-versions.txt', 128_000).read_text().splitlines()):
            raise ValueError('Restored migration inventory mismatch')
        for migration in migrations:
            run(['docker', 'exec', '-i', identifier, 'psql', '-X', '-U', 'supabase_admin', '-d', 'mizyun_restore', '-v', 'ON_ERROR_STOP=1'], data=migration.read_bytes())
        sql = ("set mizyun.restore_environment='dev';set mizyun.restore_run_id='" + token + "';\n").encode() + regular(SQL).read_bytes()
        proof = json.loads(run(['docker', 'exec', '-i', identifier, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'mizyun_restore', '-v', 'ON_ERROR_STOP=1'], data=sql))
        if not all(proof.get(k) is True for k in ('operationsClosed', 'cohortEmpty', 'deliveryEmpty', 'pushTokensEmpty', 'featureFlagsClosed', 'mediaQuarantined')) or proof.get('reopenPermitted') is not False or proof.get('revocationsReconciled') is not False:
            raise ValueError('Quarantine verification failed')
        replayed = 0
        if revocations is not None:
            import importlib.util
            specification = importlib.util.spec_from_file_location('community_revocation_replay', REPO / 'scripts/community-revocation-replay.py')
            ledger = importlib.util.module_from_spec(specification)
            specification.loader.exec_module(ledger)
            for start in range(0, len(revocations), 100):
                batch = revocations[start:start + 100]
                replay_proof = json.loads(run(['docker', 'exec', '-i', identifier, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'mizyun_restore', '-v', 'ON_ERROR_STOP=1'], data=ledger.replay_sql(batch, token)))
                if replay_proof.get('reopenPermitted') is not False or replay_proof.get('reconciliationComplete') is not False or replay_proof.get('processedCount') != len(batch):
                    raise ValueError('Revocation replay verification failed')
                replayed += len(batch)
        # Reinspect before reporting to catch changed mounts/network/identity.
        inspect_container(name, token)
        result = {'candidateSHA': candidate, 'sourceSHA': source, 'candidateMigrationHead': head,
            'forwardMigrationsApplied': len(migrations), 'restoredMigrationLedgerUpdated': False,
            'databaseCountsVerified': len(counts), 'quarantineApplied': True,
            'ledgerEventsReplayed': replayed, 'ledgerCompletenessCertified': False,
            'storageErasureVerified': False,
            'revocationsReconciled': False, 'reopenPermitted': False}
    finally:
        if attempted:
            # A failed/lost create response may still have created the resource.
            present = run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip()
            if present:
                identifier = inspect_container(name, token)
                run(['docker', 'rm', '-f', '-v', identifier])
                if run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip():
                    raise RuntimeError('Disposable resource cleanup unverified')
    return {**result, 'disposableResourcesRemoved': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--ciphertext-sha256', required=True)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--candidate-sha', required=True)
    parser.add_argument('--identity', required=True)
    parser.add_argument('--revocation-ledger')
    parser.add_argument('--ledger-checkpoint-sha256')
    args = parser.parse_args()
    def interrupted(_number, _frame):
        raise RuntimeError('Quarantined restore interrupted')
    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, interrupted)
    archive, timestamp = verify_archive(args.archive, args.ciphertext_sha256)
    validate_candidate(args.candidate_sha, args.source_sha)
    identity = regular(args.identity, 16_384)
    if stat.S_IMODE(identity.stat().st_mode) & 0o077:
        raise ValueError('Private identity permissions must exclude other users')
    if bool(args.revocation_ledger) != bool(args.ledger_checkpoint_sha256):
        raise ValueError('Ledger and independently trusted checkpoint must be supplied together')
    revocations = None
    if args.revocation_ledger:
        import importlib.util
        specification = importlib.util.spec_from_file_location('community_revocation_replay', REPO / 'scripts/community-revocation-replay.py')
        ledger = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(ledger)
        revocations = ledger.load_ledger(args.revocation_ledger, args.ledger_checkpoint_sha256, identity)
    if shutil.disk_usage(tempfile.gettempdir()).free < 3 * MAX_BYTES:
        raise ValueError('Insufficient private staging space')
    with tempfile.TemporaryDirectory(prefix='mizyun-dev-quarantine-') as scratch:
        root = Path(scratch).resolve()
        root.chmod(0o700)
        decrypted = root / 'payload.tar.gz'
        with decrypted.open('xb') as output:
            os.chmod(decrypted, 0o600)
            run(['age', '--decrypt', '--identity', str(identity), str(archive)], output=output)
        extract(regular(decrypted), root / 'payload', payload=True)
        directory = root / 'payload'
        validate_payload(directory, timestamp, args.source_sha)
        extract(directory / 'storage.tar.gz', root / 'restored-storage')
        storage = root / 'restored-storage'
        actual = {str(p.relative_to(storage)): digest(p) for p in storage.rglob('*') if p.is_file()}
        expected = checksums(regular(directory / 'storage-files.sha256', 16_000_000).read_text())
        if actual != expected:
            raise ValueError('Restored Storage file integrity mismatch')
        result = restore_payload(directory, args.candidate_sha, args.source_sha, revocations=revocations)
        result.update({'environment': 'dev', 'archiveSHA256': args.ciphertext_sha256,
            'payloadIntegrityVerified': True, 'storageFilesVerified': len(actual),
            'storageAclRestored': False, 'externalLedgerVerified': revocations is not None})
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Suppress archive SQL/content, key paths and raw command diagnostics.
        print('Quarantined Dev restore failed; no reopen permitted.', file=__import__('sys').stderr)
        raise SystemExit(1)
