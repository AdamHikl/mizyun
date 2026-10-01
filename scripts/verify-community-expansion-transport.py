#!/usr/bin/env python3
"""Start isolated loopback Auth/PostgREST/Storage against a verified empty scratch.

No shared user records or Storage files are copied. Private local runtime keys
are read in memory, passed through owner-only temporary files and removed on
exit. Containers have fresh ephemeral filesystems and are always destroyed.
The scratch database is destroyed afterward, including on acceptance failure.
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
DB_CONTAINER = 'supabase_db_mizyun'


def run(args, stdin=None):
    result = subprocess.run(args, input=stdin, text=True, capture_output=True, cwd=ROOT)
    if result.returncode:
        raise RuntimeError('Isolated infrastructure command failed')
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch-summary', type=Path, required=True)
    parser.add_argument('--logs', type=Path, required=True)
    args = parser.parse_args()
    logs = args.logs.resolve()
    if not str(logs).startswith('/private/tmp/community-'):
        raise RuntimeError('Logs must use a Community task directory in /private/tmp')
    logs.mkdir(parents=True, exist_ok=True)
    summary = json.loads(args.scratch_summary.read_text())
    db = summary['scratch_database']
    if not re.fullmatch(r'mizyun_community_verify_[a-f0-9]{12}', db) or summary.get('kept_for_transport') is not True:
        raise RuntimeError('Verified retained isolated database is required')

    def sql(statement, database=db):
        return run(['docker', 'exec', '-i', DB_CONTAINER, 'psql', '-U', 'supabase_admin', '-d', database,
                    '-X', '-v', 'ON_ERROR_STOP=1', '-At'], statement)

    if sql('select count(*) from auth.users;').strip() != '0':
        raise RuntimeError('Refusing nonempty Auth database')
    try:
        # Restore service-owned schemas and migration version rows, never accounts/files.
        owned = run(['docker', 'exec', DB_CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-privileges'])
        statements = [line for line in owned.splitlines() if line.startswith('ALTER ') and
                      ((' auth.' in line and ' OWNER TO supabase_auth_admin' in line) or
                       (' storage.' in line and ' OWNER TO supabase_storage_admin' in line))]
        sql('\n'.join(statements))
        for table in ['auth.schema_migrations', 'storage.migrations']:
            sql('truncate ' + table + ';')
            sql(run(['docker', 'exec', DB_CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only', '--no-owner', '--no-privileges', '--table', table]))
        sql("delete from public.community_handle_quarantine; update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,delivery=false,cohort_required=true;")
        config = json.loads(run(['pnpm', 'exec', 'supabase', 'status', '-o', 'json']))
    except Exception:
        sql('drop database ' + db + ';', 'postgres')
        raise
    names, files = [], []
    ports = {'/auth/v1': 55441, '/rest/v1': 55442, '/storage/v1': 55443}

    class NoRedirects(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise RuntimeError('Redirect denied')

    class Proxy(http.server.BaseHTTPRequestHandler):
        def do(self):
            prefix = next((p for p in ports if self.path.startswith(p + '/')), None)
            if prefix is None:
                self.send_response(404)
                self.end_headers()
                return
            try:
                size = int(self.headers.get('Content-Length', 0))
                if size > 5_000_000:
                    self.send_response(413)
                    self.end_headers()
                    return
                data = self.rfile.read(size) if size else None
                headers = {k: v for k, v in self.headers.items() if k.lower() not in ['host', 'connection', 'content-length']}
                request = urllib.request.Request('http://127.0.0.1:' + str(ports[prefix]) + self.path[len(prefix):], data=data, headers=headers, method=self.command)
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
                try:
                    response = opener.open(request, timeout=30)
                except urllib.error.HTTPError as error:
                    response = error
                raw = response.read()
                self.send_response(response.code)
                for key, value in response.headers.items():
                    if key.lower() not in ['transfer-encoding', 'connection', 'content-length']:
                        self.send_header(key, value)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except Exception:
                self.send_response(502)
                self.end_headers()

        def log_message(self, *unused):
            pass
        do_GET = do
        do_POST = do
        do_PATCH = do
        do_PUT = do
        do_DELETE = do
        do_HEAD = do

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
    started = False
    rest_name = None
    try:
        for original, uri_key, prefix, internal in [
            ('supabase_auth_mizyun', 'GOTRUE_DB_DATABASE_URL', '/auth/v1', 9999),
            ('supabase_rest_mizyun', 'PGRST_DB_URI', '/rest/v1', 3000),
            ('supabase_storage_mizyun', 'DATABASE_URL', '/storage/v1', 5000),
        ]:
            info = json.loads(run(['docker', 'inspect', original]))[0]
            env = dict(item.split('=', 1) for item in info['Config']['Env'])
            uri = urllib.parse.urlsplit(env[uri_key])
            if uri.hostname != DB_CONTAINER:
                raise RuntimeError('Expected local database container target')
            env[uri_key] = urllib.parse.urlunsplit(uri._replace(path='/' + db))
            if prefix == '/auth/v1':
                env.update({'GOTRUE_EXTERNAL_APPLE_ENABLED': 'false', 'GOTRUE_DISABLE_SIGNUP': 'true', 'GOTRUE_MAILER_AUTOCONFIRM': 'true', 'GOTRUE_MFA_TOTP_ENROLL_ENABLED': 'true', 'GOTRUE_MFA_TOTP_VERIFY_ENABLED': 'true'})
                for key in list(env):
                    if key.startswith('GOTRUE_HOOK_'):
                        del env[key]
                for key in list(env):
                    if key.startswith('GOTRUE_EXTERNAL_APPLE_') and key != 'GOTRUE_EXTERNAL_APPLE_ENABLED':
                        del env[key]
            if prefix == '/storage/v1':
                for key in ['PGRST_URL', 'POSTGREST_URL']:
                    if key in env:
                        if rest_name is None:
                            raise RuntimeError('Cloned REST target is required')
                        env[key] = 'http://' + rest_name + ':3000'
                env.update({'STORAGE_BACKEND': 'file', 'FILE_STORAGE_BACKEND_PATH': '/var/lib/storage', 'ENABLE_IMAGE_TRANSFORMATION': 'false', 'S3_PROTOCOL_ENABLED': 'false'})
            private = logs / (original + '.private.env')
            private.touch(mode=0o600)
            os.chmod(private, 0o600)
            files.append(private)
            private.write_text('\n'.join(key + '=' + value for key, value in env.items()) + '\n')
            name = 'mizyun-community-expansion-' + uuid.uuid4().hex[:8]
            names.append(name)
            if prefix == '/rest/v1':
                rest_name = name
            run(['docker', 'run', '--rm', '-d', '--name', name, '--network', 'supabase_network_mizyun', '-p', '127.0.0.1:' + str(ports[prefix]) + ':' + str(internal), '--env-file', str(private), info['Config']['Image']])
        threading.Thread(target=server.serve_forever, daemon=True).start()
        started = True
        cfg = {key: config[key] for key in ['ANON_KEY', 'SERVICE_ROLE_KEY']}
        cfg['API_URL'] = 'http://127.0.0.1:' + str(server.server_port)
        cfg['DB_URL'] = 'postgresql://postgres@127.0.0.1:54322/' + db
        private = logs / 'transport.private.json'
        private.touch(mode=0o600)
        os.chmod(private, 0o600)
        files.append(private)
        private.write_text(json.dumps(cfg))
        for port, path in [(55441, '/health'), (55442, '/community_operations?select=enabled'), (55443, '/status')]:
            ready = False
            for attempt in range(30):
                request = urllib.request.Request('http://127.0.0.1:' + str(port) + path, headers={'apikey': config['SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + config['SERVICE_ROLE_KEY']})
                try:
                    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects()).open(request, timeout=1) as response:
                        ready = response.status == 200
                except Exception:
                    pass
                if ready:
                    break
                time.sleep(0.5)
            if not ready:
                raise RuntimeError('Isolated service startup readiness failed')
        for script in ['scripts/test-community-postgrest.py', 'scripts/test-community-expansion-postgrest.py']:
            result = subprocess.run(['python3', script, '--disposable-local-stack', '--config', str(private)], cwd=ROOT, text=True, capture_output=True)
            (logs / (Path(script).stem + '.log')).write_text(result.stdout + result.stderr)
            print(result.stdout + result.stderr, flush=True)
            if result.returncode:
                raise RuntimeError('Isolated transport acceptance failed; scratch destroyed')
        print('PASS actual isolated Auth/PostgREST/Storage expansion verification', flush=True)
    finally:
        if started:
            server.shutdown()
        server.server_close()
        remaining = []
        for name in names:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
            if subprocess.run(['docker', 'inspect', name], capture_output=True).returncode == 0:
                remaining.append(name)
        for private in files:
            private.unlink(missing_ok=True)
        if remaining:
            raise RuntimeError('Isolated container cleanup incomplete; do not claim removal')
        sql('drop database ' + db + ';', 'postgres')
        print('Removed isolated services, ephemeral files, private credential files and scratch database', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Isolated infrastructure failure', flush=True)
        raise SystemExit(1)
