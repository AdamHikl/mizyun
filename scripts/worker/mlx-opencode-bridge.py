#!/usr/bin/env python3
"""
Bridge between OpenCode (which calls OpenAI /v1/responses or /v1/chat/completions)
and mlx_lm.server (which runs on 127.0.0.1:8080).
Normalizes multipart message content arrays to plain strings and bridges /v1/responses.
"""
import http.server
import urllib.request
import json
import sys

BRIDGE_PORT = 8082
MLX_PORT = 8080
TARGET = f"http://127.0.0.1:{MLX_PORT}"

def normalize_messages(messages):
    normalized = []
    for m in messages:
        role = m.get("role", "user")
        raw_content = m.get("content", "")
        if isinstance(raw_content, str):
            text = raw_content
        elif isinstance(raw_content, list):
            parts = []
            for p in raw_content:
                if isinstance(p, str):
                    parts.append(p)
                elif isinstance(p, dict):
                    if "text" in p:
                        parts.append(p["text"])
                    elif "content" in p:
                        parts.append(str(p["content"]))
            text = "\n".join(parts)
        else:
            text = str(raw_content)
        normalized.append({"role": role, "content": text})
    return normalized

class BridgeHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress noisy standard request logging
        pass

    def do_GET(self):
        self.proxy()

    def do_POST(self):
        self.proxy()

    def proxy(self):
        length = int(self.headers.get("content-length", 0))
        body = self.rfile.read(length) if length > 0 else None
        
        path = self.path
        if path == "/v1/responses":
            path = "/v1/chat/completions"

        if body and "/chat/completions" in path:
            try:
                p = json.loads(body.decode("utf-8"))
                if "input" in p:
                    inp = p.pop("input")
                    if isinstance(inp, list):
                        p["messages"] = normalize_messages(inp)
                    elif isinstance(inp, str):
                        p["messages"] = [{"role": "user", "content": inp}]
                elif "messages" in p:
                    p["messages"] = normalize_messages(p["messages"])

                if "max_output_tokens" in p:
                    p["max_tokens"] = p.pop("max_output_tokens")
                p.pop("store", None)
                body = json.dumps(p).encode("utf-8")
            except Exception as e:
                print(f"[Bridge Error] Transform error: {e}", file=sys.stderr)

        req = urllib.request.Request(f"{TARGET}{path}", data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in ["host", "content-length"]:
                req.add_header(k, v)
        if body:
            req.add_header("Content-Length", str(len(body)))
            req.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(req) as res:
                self.send_response(res.status)
                for k, v in res.getheaders():
                    if k.lower() != "transfer-encoding":
                        self.send_header(k, v)
                self.end_headers()
                while True:
                    chunk = res.read(2048)
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except BrokenPipeError:
                        break
        except urllib.error.HTTPError as e:
            err_data = e.read()
            try:
                self.send_response(e.code)
                self.end_headers()
                self.wfile.write(err_data)
            except BrokenPipeError:
                pass
        except Exception as e:
            try:
                self.send_response(500)
                self.end_headers()
            except BrokenPipeError:
                pass

if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", BRIDGE_PORT), BridgeHandler)
    print(f"MLX-OpenCode Bridge ready on 127.0.0.1:{BRIDGE_PORT} -> {TARGET}", file=sys.stderr)
    server.serve_forever()
