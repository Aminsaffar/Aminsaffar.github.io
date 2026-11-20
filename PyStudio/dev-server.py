"""Serve this static project locally for development; it never runs Python submitted to PyStudio."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class StaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description="Serve PyStudio's static files only.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="HTTP port (default: 8000)")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), StaticHandler)
    print(f"Serving static PyStudio files at http://{args.host}:{args.port} (Python code runs in the browser)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping static file server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
