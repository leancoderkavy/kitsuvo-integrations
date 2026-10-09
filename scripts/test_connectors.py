"""Exercise the real Rust MCP client against disposable stdio and HTTP fixtures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'crates/kitsuvo-connectors/target/debug' / ('kitsuvo-connectors.exe' if os.name == 'nt' else 'kitsuvo-connectors')


def answer(message):
    method = message.get('method')
    if 'id' not in message:
        return None
    if method == 'initialize':
        result = {'protocolVersion': message['params']['protocolVersion'], 'capabilities': {'tools': {}},
                  'serverInfo': {'name': 'kitsuvo-fixture', 'version': '1.0'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'echo', 'description': 'Echo fixture input.', 'inputSchema': {'type': 'object'},
                             'annotations': {'readOnlyHint': True}},
                            {'name': 'connect', 'description': 'A tool named like a connection action.',
                             'inputSchema': {'type': 'object'}}]}
    elif method == 'tools/call':
        result = {'content': [{'type': 'text', 'text': json.dumps({'arguments': message['params']['arguments'],
                   'inherited_secret': os.environ.get('KITSUVO_TEST_SECRET')})}], 'isError': False}
    else:
        return {'jsonrpc': '2.0', 'id': message['id'], 'error': {'code': -32601, 'message': 'Unknown method'}}
    return {'jsonrpc': '2.0', 'id': message['id'], 'result': result}


if '--stdio-fixture' in sys.argv:
    for line in sys.stdin:
        response = answer(json.loads(line))
        if response is not None:
            print(json.dumps(response), flush=True)
    sys.exit(0)


class HTTPFixture(BaseHTTPRequestHandler):
    def do_POST(self):
        message = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        response = answer(message)
        payload = json.dumps(response).encode() if response is not None else b''
        self.send_response(200 if response is not None else 202)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_DELETE(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


class ConnectorContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.registry = Path(self.temp.name) / 'registry.json'
        self.registry.write_text(json.dumps({'connectors': {'fixture': {
            'transport': 'stdio', 'command': sys.executable,
            'args': [str(Path(__file__).resolve()), '--stdio-fixture']}}}))

    def tearDown(self):
        self.temp.cleanup()

    def run_client(self, *args):
        env = dict(os.environ, KITSUVO_TEST_SECRET='must-not-leak')
        return subprocess.run([str(BINARY), '--config', str(self.registry), *args],
                              env=env, capture_output=True, text=True, timeout=90)

    def test_discovery_requires_process_consent(self):
        result = self.run_client('tools', 'fixture')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Approval required', result.stderr)

    def test_stdio_catalog_and_tool_call_do_not_inherit_secrets(self):
        result = self.run_client('tools', 'fixture', '--approve', 'fixture:connect')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[0]['name'], 'echo')
        result = self.run_client('call', 'fixture', 'echo', '{"message":"hello"}', '--approve', 'fixture:connect', '--approve', 'fixture:tool:echo')
        self.assertEqual(result.returncode, 0, result.stderr)
        text = json.loads(result.stdout)['content'][0]['text']
        self.assertEqual(json.loads(text), {'arguments': {'message': 'hello'}, 'inherited_secret': None})

    def test_call_requires_exact_tool_consent(self):
        result = self.run_client('call', 'fixture', 'echo', '{}', '--approve', 'fixture:connect', '--approve', 'other:tool:echo')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture:tool:echo', result.stderr)

    def test_unknown_tools_are_not_sent(self):
        result = self.run_client('call', 'fixture', 'delete', '{}', '--approve', 'fixture:connect', '--approve', 'fixture:tool:delete')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('current catalog', result.stderr)

    def test_connection_consent_cannot_authorize_a_tool_named_connect(self):
        result = self.run_client('call', 'fixture', 'connect', '{}', '--approve', 'fixture:connect')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture:tool:connect', result.stderr)
        result = self.run_client('call', 'fixture', 'connect', '{}', '--approve', 'fixture:connect',
                                 '--approve', 'fixture:tool:connect')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_http_streamable_discovery(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), HTTPFixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.registry.write_text(json.dumps({'connectors': {'fixture': {'transport': 'http', 'url': f'http://127.0.0.1:{server.server_port}/mcp'}}}))
            result = self.run_client('tools', 'fixture', '--approve', 'fixture:connect')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)[0]['name'], 'echo')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_redirect_does_not_forward_credentials_or_requests(self):
        class Redirect(HTTPFixture):
            reached = False
            def do_POST(self):
                if self.path == '/mcp':
                    self.send_response(307)
                    self.send_header('Location', f'http://127.0.0.1:{self.server.server_port}/redirect-target')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                else:
                    Redirect.reached = True
                    super().do_POST()
        server = ThreadingHTTPServer(('127.0.0.1', 0), Redirect)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.registry.write_text(json.dumps({'connectors': {'fixture': {'transport': 'http', 'url': f'http://127.0.0.1:{server.server_port}/mcp'}}}))
            result = self.run_client('tools', 'fixture', '--approve', 'fixture:connect')
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(Redirect.reached)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
