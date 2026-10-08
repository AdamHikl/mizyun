#!/usr/bin/env python3
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('revocations', Path(__file__).with_name('community-revocation-replay.py'))
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)
EVENT = {'event_id': '11111111-1111-4111-8111-111111111111', 'user_id': '22222222-2222-4222-8222-222222222222', 'kind': 'account_erasure', 'generation': None, 'target_id': '22222222-2222-4222-8222-222222222222', 'related_user_id': None, 'created_at': '2026-10-08T12:00:00Z'}


class LedgerReplayTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='ledger-replay-test-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name).resolve()
        os.chmod(self.root, 0o700)
        self.payload = json.dumps({'schema': 1, 'environment': 'dev', 'event': EVENT}, separators=(',', ':')).encode()
        self.ciphertext = b'synthetic:' + self.payload
        self.entry = {'schema': 1, 'environment': 'dev', 'sequence': 1, 'previous': '0' * 64, 'eventId': EVENT['event_id'], 'hash': hashlib.sha256(self.payload).hexdigest(), 'ciphertext': hashlib.sha256(self.ciphertext).hexdigest()}
        self.cipher = self.root / (EVENT['event_id'] + '.age')
        self.write(self.cipher, self.ciphertext)
        self.save()

    def write(self, path, data):
        path.write_bytes(data)
        path.chmod(0o600)

    def save(self, lines=None):
        data = (json.dumps(self.entry, separators=(',', ':')) + '\n').encode() if lines is None else lines
        self.write(self.root / 'journal.jsonl', data)
        self.checkpoint = hashlib.sha256(data).hexdigest()

    def load(self, **kwargs):
        return ledger.load_ledger(self.root, kwargs.pop('checkpoint', self.checkpoint), 'synthetic-identity', decrypt=lambda value, _: value[len(b'synthetic:'):], **kwargs)

    def test_valid_external_pin_and_sql_literal_safety(self):
        self.assertEqual(self.load(), [EVENT])
        statement = ledger.replay_sql([EVENT], 'a' * 32)
        self.assertIn(b"decode('", statement)
        self.assertNotIn(EVENT['user_id'].encode(), statement)
        with self.assertRaises(ValueError):
            ledger.replay_sql([EVENT], "';drop database postgres;")

    def test_wrong_pin_or_truncated_chain(self):
        with self.assertRaises(ValueError):
            self.load(checkpoint='0' * 64)
        self.save((self.root / 'journal.jsonl').read_bytes().rstrip(b'\n'))
        with self.assertRaises(ValueError):
            self.load()

    def test_wrong_environment_and_chain_gap(self):
        with self.assertRaises(ValueError):
            self.load(environment='production')
        self.entry['sequence'] = 2
        self.save()
        with self.assertRaises(ValueError):
            self.load()

    def test_ciphertext_and_plaintext_tampering(self):
        self.write(self.cipher, b'changed')
        with self.assertRaises(ValueError):
            self.load()
        self.write(self.cipher, self.ciphertext)
        self.entry['hash'] = '0' * 64
        self.save()
        with self.assertRaises(ValueError):
            self.load()

    def test_duplicate_record(self):
        line = (self.root / 'journal.jsonl').read_bytes()
        self.save(line + line)
        with self.assertRaises(ValueError):
            self.load()

    def test_symlink_or_world_readable_file(self):
        self.cipher.chmod(0o644)
        with self.assertRaises(ValueError):
            self.load()
        self.cipher.unlink()
        target = self.root / 'secret'
        self.write(target, self.ciphertext)
        self.cipher.symlink_to(target)
        with self.assertRaises(OSError):
            self.load()

    def test_unknown_fields_invalid_uuid_and_boolean_generation(self):
        for patch in ({'notes': 'private'}, {'user_id': '../path'}, {'generation': True}, {'kind': 'publish'}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                ledger.validate_event({**EVENT, **patch})


if __name__ == '__main__':
    unittest.main()
