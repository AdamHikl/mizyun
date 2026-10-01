#!/usr/bin/env python3
"""Synthetic files/mock Docker only. No age key, decryption or user archive."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('quarantine_restore', Path(__file__).with_name('restore-dev-quarantined.py'))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)
TOKEN = 'e' * 32
ID = 'a' * 64
SOURCE = 'b' * 40
CANDIDATE = 'c' * 40
STAMP = '20261001T205037Z'
PROOF = {'operationsClosed': True, 'cohortEmpty': True, 'deliveryEmpty': True,
         'pushTokensEmpty': True, 'featureFlagsClosed': True, 'mediaQuarantined': True,
         'revocationsReconciled': False, 'reopenPermitted': False}


def packed(path, entries):
    with tarfile.open(path, 'w:gz') as archive:
        for name, content, kind in entries:
            member = tarfile.TarInfo(name)
            member.type = kind
            if kind == tarfile.REGTYPE:
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
            else:
                member.linkname = '/outside' if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE) else ''
                archive.addfile(member)


def fixture(directory):
    directory.mkdir()
    for name in restore.PAYLOAD - {'PAYLOAD_SHA256SUMS'}:
        (directory / name).write_bytes(b'synthetic')
    (directory / 'metadata.txt').write_text(f'created_at={STAMP}\nsource_sha={SOURCE}\ndatabase_container=mizyun-dev-db\nenvironment=dev\nformat_version=1\ncommunity_restore_traffic=closed_until_revocation_reconciliation\n')
    (directory / 'globals.sql').write_text('CREATE ROLE fixture_role;\n')
    (directory / 'table-counts.tsv').write_text('public.profiles\t2\n')
    (directory / 'migration-versions.txt').write_text('20260714100000\n')
    remanifest(directory)


def remanifest(directory):
    (directory / 'PAYLOAD_SHA256SUMS').write_text(''.join(restore.digest(directory / name) + '  ' + name + '\n' for name in sorted(restore.PAYLOAD - {'PAYLOAD_SHA256SUMS'})))


def container():
    return {'Id': ID, 'Name': '/mizyun-dev-quarantine-' + TOKEN,
        'Config': {'Labels': {restore.LABEL: TOKEN}},
        'HostConfig': {'NetworkMode': 'none', 'PortBindings': {}, 'Privileged': False},
        'NetworkSettings': {'Ports': {'5432/tcp': None}},
        'Mounts': [{'Type': 'tmpfs', 'Destination': '/var/lib/postgresql/data'}]}


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)

    def test_exact_completed_dev_ciphertext_with_independent_digest(self):
        archive = self.root / f'mizyun-dev-{STAMP}.tar.gz.age'
        archive.write_bytes(b'synthetic ciphertext, never decrypted')
        expected = restore.digest(archive)
        (self.root / 'COMPLETE').write_text(STAMP + '\n')
        (self.root / 'SHA256SUMS').write_text(expected + '  ' + archive.name + '\n')
        self.assertEqual(restore.verify_archive(archive, expected), (archive, STAMP))
        with self.assertRaisesRegex(ValueError, 'integrity'):
            restore.verify_archive(archive, '0' * 64)
        archive.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            restore.verify_archive(archive, expected)

    def test_wrong_environment_filename_and_completion_are_denied(self):
        archive = self.root / f'mizyun-production-{STAMP}.tar.gz.age'
        archive.write_bytes(b'synthetic')
        with self.assertRaisesRegex(ValueError, 'Dev archive'):
            restore.verify_archive(archive, restore.digest(archive))
        archive = archive.rename(self.root / f'mizyun-dev-{STAMP}.tar.gz.age')
        (self.root / 'COMPLETE').write_text('wrong')
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            restore.verify_archive(archive, restore.digest(archive))

    def test_missing_duplicate_extra_or_traversal_checksum_entries_denied(self):
        for text in ('', 'a' * 64 + '  ../secret\n', ('a' * 64 + '  database.dump\n') * 2):
            with self.subTest(text=text[:20]), self.assertRaises(ValueError):
                restore.checksums(text, {'database.dump'})

    def test_symlink_inputs_denied(self):
        actual = self.root / 'actual'
        actual.write_bytes(b'synthetic')
        link = self.root / 'link'
        link.symlink_to(actual)
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            restore.regular(link)

    def test_safe_regular_storage_extraction_ignores_modes_ownership(self):
        archive = self.root / 'storage.tar.gz'
        packed(archive, [('storage', b'', tarfile.DIRTYPE), ('storage/private/image.jpg', b'jpeg', tarfile.REGTYPE)])
        restore.extract(archive, self.root / 'output')
        output = self.root / 'output/storage/private/image.jpg'
        self.assertEqual(output.read_bytes(), b'jpeg')
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_payload_paths_links_devices_and_duplicates_denied(self):
        invalid = [('storage/../secret', tarfile.REGTYPE), ('/storage/secret', tarfile.REGTYPE),
                   ('storage/link', tarfile.SYMTYPE), ('storage/link', tarfile.LNKTYPE),
                   ('storage/device', tarfile.CHRTYPE), ('unexpected', tarfile.REGTYPE)]
        for index, (name, kind) in enumerate(invalid):
            archive = self.root / ('invalid-' + str(index) + '.tar.gz')
            packed(archive, [(name, b'bytes', kind)])
            with self.subTest(name=name), self.assertRaises(ValueError):
                restore.extract(archive, self.root / ('out-' + str(index)))
        archive = self.root / 'duplicate.tar.gz'
        packed(archive, [('storage/a', b'a', tarfile.REGTYPE), ('./storage/a', b'b', tarfile.REGTYPE)])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            restore.extract(archive, self.root / 'duplicates')

    def test_bounded_expansion_before_file_write(self):
        archive = self.root / 'big.tar.gz'
        packed(archive, [('storage/a', b'12345', tarfile.REGTYPE)])
        with patch.object(restore, 'MAX_BYTES', 4), self.assertRaisesRegex(ValueError, 'exceeds'):
            restore.extract(archive, self.root / 'large')
        self.assertFalse((self.root / 'large/storage/a').exists())

    def test_exact_payload_manifest_and_metadata_source_are_required(self):
        directory = self.root / 'payload'
        fixture(directory)
        restore.validate_payload(directory, STAMP, SOURCE)
        (directory / 'database.dump').write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'Payload integrity'):
            restore.validate_payload(directory, STAMP, SOURCE)
        remanifest(directory)
        with self.assertRaisesRegex(ValueError, 'metadata'):
            restore.validate_payload(directory, STAMP, 'd' * 40)
        (directory / 'metadata.txt').write_text((directory / 'metadata.txt').read_text().replace('environment=dev', 'environment=production'))
        remanifest(directory)
        with self.assertRaisesRegex(ValueError, 'metadata'):
            restore.validate_payload(directory, STAMP, SOURCE)


class IsolationTests(unittest.TestCase):
    def test_environment_cannot_select_remote_docker_or_disclose_errors(self):
        with patch.object(restore.os, 'environ', {'PATH': '/bin', 'HOME': '/tmp', 'DOCKER_HOST': 'tcp://production:2375'}), patch.object(restore.subprocess, 'run') as command:
            command.return_value = subprocess.CompletedProcess([], 0, b'[]', b'')
            restore.run(['docker', 'inspect', 'fixture'])
            self.assertEqual(command.call_args.args[0][:2], ['docker', '--host=unix:///var/run/docker.sock'])
            self.assertNotIn('DOCKER_HOST', command.call_args.kwargs['env'])
            command.return_value = subprocess.CompletedProcess([], 1, b'private', b'sensitive SQL credentials')
            with self.assertRaisesRegex(RuntimeError, '^Quarantined restore command failed$'):
                restore.run(['docker', 'inspect', 'fixture'])

    def test_wrong_identity_labels_network_ports_privilege_or_mounts_denied(self):
        mutations = [lambda e: e.update(Name='/mizyun-dev-db'),
            lambda e: e['Config']['Labels'].clear(),
            lambda e: e['HostConfig'].update(NetworkMode='host'),
            lambda e: e['HostConfig'].update(PortBindings={'5432': [{}]}),
            lambda e: e['HostConfig'].update(Privileged=True),
            lambda e: e.update(Mounts=[{'Type': 'bind', 'Source': '/srv/mizyun'}])]
        for change in mutations:
            entry = container()
            change(entry)
            with self.subTest(entry=entry), patch.object(restore, 'run', return_value=json.dumps([entry]).encode()), self.assertRaises(ValueError):
                restore.inspect_container('mizyun-dev-quarantine-' + TOKEN, TOKEN)

    def workflow(self, *, fail=None, proof=PROOF, duplicate=False, table_inventory=b'public.profiles\n', migration_inventory=b'20260714100000\n', count=b'2\n', init_complete=True):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name).resolve() / 'payload'
        fixture(directory)
        calls, created = [], False
        def command(args, **kwargs):
            nonlocal created
            calls.append((args, kwargs))
            if args[:3] == ['docker', 'ps', '-a']:
                return ID.encode() if created or duplicate else b''
            if args[:2] == ['docker', 'run']:
                created = True
                if fail == 'lost-create':
                    raise RuntimeError('Lost create response')
                return ID.encode()
            if args[:2] == ['docker', 'inspect']:
                return json.dumps([container()]).encode()
            if args[:2] == ['docker', 'logs']:
                return b'PostgreSQL init process complete' if init_complete else b'temporary init server is ready to accept connections'
            if args[:2] == ['docker', 'rm']:
                created = fail == 'cleanup'
                return b''
            if 'pg_restore' in args and fail == 'restore':
                raise RuntimeError('Restore failed')
            if '-Atc' in args:
                if 'pg_stat_user_tables' in args[-1]:
                    return table_inventory
                if 'schema_migrations' in args[-1]:
                    return migration_inventory
                return count
            if b'restore_environment' in kwargs.get('data', b''):
                return json.dumps(proof).encode()
            return b''
        with patch.object(restore, 'candidate_migrations', return_value=([], '20261001207000')), patch.object(restore.uuid, 'uuid4') as identity, patch.object(restore, 'run', side_effect=command), patch.object(restore.time, 'sleep'):
            identity.return_value.hex = TOKEN
            try:
                result = restore.restore_payload(directory, CANDIDATE, SOURCE)
                return result, calls, None
            except Exception as error:
                return None, calls, error

    def test_success_proves_closed_disposable_and_never_starts_live_services(self):
        result, calls, error = self.workflow()
        self.assertIsNone(error)
        self.assertFalse(result['reopenPermitted'])
        self.assertFalse(result['revocationsReconciled'])
        self.assertTrue(result['disposableResourcesRemoved'])
        self.assertFalse(result['restoredMigrationLedgerUpdated'])
        create = next(args for args, _ in calls if args[:2] == ['docker', 'run'])
        self.assertEqual(create[create.index('--network') + 1], 'none')
        self.assertEqual(create[create.index('--pull') + 1], 'never')
        self.assertNotIn('--publish', create)
        self.assertNotIn('-v', create)
        self.assertTrue(all(args[0] == 'docker' for args, _ in calls))
        self.assertEqual(calls[-2][0], ['docker', 'rm', '-f', '-v', ID])
        globals_sql = next(kwargs['data'] for args, kwargs in calls if kwargs.get('data', b'').startswith(b'DO $mizyun$'))
        self.assertIn(b'EXCEPTION WHEN duplicate_object', globals_sql)

    def test_missing_extra_tables_migrations_or_count_mismatch_fail_and_cleanup(self):
        for kwargs in ({'table_inventory': b''}, {'table_inventory': b'public.profiles\npublic.extra\n'},
                       {'migration_inventory': b'20260714100000\n20260715100000\n'}, {'count': b'3\n'}):
            with self.subTest(kwargs=kwargs):
                result, calls, error = self.workflow(**kwargs)
                self.assertIsNone(result)
                self.assertIsInstance(error, ValueError)
                self.assertEqual(calls[-2][0], ['docker', 'rm', '-f', '-v', ID])
                self.assertFalse(any(b'restore_environment' in options.get('data', b'') for _, options in calls))

    def test_temporary_init_server_cannot_be_used_as_ready_database(self):
        result, calls, error = self.workflow(init_complete=False)
        self.assertIsNone(result)
        self.assertIsInstance(error, RuntimeError)
        self.assertFalse(any('pg_restore' in args or 'createdb' in args for args, _ in calls))
        self.assertEqual(calls[-2][0], ['docker', 'rm', '-f', '-v', ID])

    def test_partial_failure_and_lost_create_response_clean_exact_owned_id(self):
        for failure in ('lost-create', 'restore'):
            result, calls, error = self.workflow(fail=failure)
            self.assertIsNone(result)
            self.assertIsNotNone(error)
            self.assertEqual(calls[-2][0], ['docker', 'rm', '-f', '-v', ID])

    def test_cleanup_response_without_removed_resource_cannot_report_success(self):
        result, calls, error = self.workflow(fail='cleanup')
        self.assertIsNone(result)
        self.assertIsInstance(error, RuntimeError)
        self.assertIn('cleanup unverified', str(error))

    def test_duplicate_name_is_never_created_or_deleted(self):
        result, calls, error = self.workflow(duplicate=True)
        self.assertIsNone(result)
        self.assertIsInstance(error, ValueError)
        self.assertFalse(any(args[:2] in (['docker', 'run'], ['docker', 'rm']) for args, _ in calls))

    def test_failed_quarantine_never_produces_reopen_or_success_proof(self):
        result, calls, error = self.workflow(proof={**PROOF, 'operationsClosed': False})
        self.assertIsNone(result)
        self.assertIsInstance(error, ValueError)
        self.assertEqual(calls[-2][0], ['docker', 'rm', '-f', '-v', ID])

    def test_source_guard_failure_precedes_private_identity_and_age_access(self):
        args = ['restore-dev-quarantined.py', '--archive', '/synthetic/ciphertext',
                '--ciphertext-sha256', 'f' * 64, '--source-sha', SOURCE,
                '--candidate-sha', CANDIDATE, '--identity', '/never/access/identity']
        with patch.object(sys, 'argv', args), patch.object(restore, 'verify_archive', return_value=(Path('/synthetic/ciphertext'), STAMP)), patch.object(restore, 'validate_candidate', side_effect=ValueError('Candidate checkout must be pristine')), patch.object(restore, 'regular') as private_file, patch.object(restore, 'run') as command:
            with self.assertRaisesRegex(ValueError, 'pristine'):
                restore.main()
            private_file.assert_not_called()
            command.assert_not_called()

    def test_candidate_dirty_mismatch_and_out_of_order_prefix_denied(self):
        with patch.object(restore, 'run', side_effect=[b'wrong-sha']):
            with self.assertRaisesRegex(ValueError, 'checkout mismatch'):
                restore.candidate_migrations(CANDIDATE, SOURCE, '20260714100000')
        with patch.object(restore, 'run', side_effect=[CANDIDATE.encode(), b' M dirty']):
            with self.assertRaisesRegex(ValueError, 'pristine'):
                restore.candidate_migrations(CANDIDATE, SOURCE, '20260714100000')
        with patch.object(restore, 'run', side_effect=[CANDIDATE.encode(), b'', b'']):
            with self.assertRaisesRegex(ValueError, 'prefix'):
                restore.candidate_migrations(CANDIDATE, SOURCE, '20990101000000')


if __name__ == '__main__':
    unittest.main()
