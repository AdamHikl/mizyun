import http.server
import urllib.request
import json
import sys

PORT = 8081
TARGET = "http://127.0.0.1:8080"

def flatten_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts = []
        for part in content:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict):
                if part.get('type') == 'text' and 'text' in part:
                    text_parts.append(part['text'])
                elif 'text' in part:
                    text_parts.append(part['text'])
                elif 'content' in part:
                    text_parts.append(str(part['content']))
        return "\n".join(text_parts)
    return str(content)

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.proxy()

    def do_POST(self):
        self.proxy()

    def proxy(self):
        length = int(self.headers.get('content-length', 0))
        body = self.rfile.read(length) if length > 0 else None
        
        path = self.path
        is_responses = (path == '/v1/responses')
        if is_responses:
            path = '/v1/chat/completions'

        if body and '/chat/completions' in path:
            try:
                p = json.loads(body)
                messages = []
                if 'input' in p:
                    inp = p.pop('input')
                    if isinstance(inp, list):
                        for item in inp:
                            if isinstance(item, str):
                                messages.append({'role': 'user', 'content': item})
                            elif isinstance(item, dict):
                                messages.append(item)
                    elif isinstance(inp, str):
                        messages.append({'role': 'user', 'content': inp})
                    p['messages'] = messages

                if 'messages' in p:
                    for m in p['messages']:
                        if 'content' in m:
                            m['content'] = flatten_content(m['content'])

                if 'max_output_tokens' in p:
                    p['max_tokens'] = p.pop('max_output_tokens')
                p.pop('store', None)
                body = json.dumps(p).encode('utf-8')
            except Exception as e:
                print(f"Transform error: {e}", file=sys.stderr)

        print(f"Forwarding [{self.command}] {self.path} -> {path}", file=sys.stderr)

        req = urllib.request.Request(f"{TARGET}{path}", data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in ['host', 'content-length']:
                req.add_header(k, v)
        if body:
            req.add_header('Content-Length', str(len(body)))
            req.add_header('Content-Type', 'application/json')

        try:
            with urllib.request.urlopen(req) as res:
                self.send_response(res.status)
                for k, v in res.getheaders():
                    if k.lower() != 'transfer-encoding':
                        self.send_header(k, v)
                self.end_headers()
                while True:
                    chunk = res.read(1024)
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except BrokenPipeError:
                        break
        except urllib.error.HTTPError as e:
            err_data = e.read()
            print(f"HTTPError {e.code} for {path}: {err_data.decode('utf-8', errors='replace')}", file=sys.stderr)
            try:
                self.send_response(e.code)
                self.end_headers()
                self.wfile.write(err_data)
            except BrokenPipeError:
                pass
        except Exception as e:
            print(f"Proxy error: {e}", file=sys.stderr)
            try:
                self.send_response(500)
                self.end_headers()
            except BrokenPipeError:
                pass

if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), ProxyHandler)
    print(f"Logging adapter listening on 127.0.0.1:{PORT} -> {TARGET}", file=sys.stderr)
    server.serve_forever()
