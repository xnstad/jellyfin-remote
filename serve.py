#!/usr/bin/env python3
import argparse, os, sys, mimetypes
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# Make sure .webmanifest has the right type (some defaults don't)
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('application/javascript', '.mjs')

class Handler(SimpleHTTPRequestHandler):
    # Strengthen the default map just in case
    extensions_map = SimpleHTTPRequestHandler.extensions_map | {
        '.webmanifest': 'application/manifest+json',
        '.mjs': 'application/javascript',
        '.js': 'application/javascript',
    }

    def end_headers(self):
        # Cache: don't cache app shell; do cache static assets
        p = self.path.split('?',1)[0]
        if p == '/' or p.endswith('/index.html') or p == '/sw.js':
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        elif p.endswith(('.js','.css','.png','.jpg','.jpeg','.svg','.webp','.ico','.ttf','.woff','.woff2','.webmanifest')):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        # Let the SW control root if needed
        if p == '/sw.js':
            self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt%args))
        sys.stdout.flush()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bind', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=8081)
    ap.add_argument('--dir', default='.')
    args = ap.parse_args()

    os.chdir(args.dir)
    httpd = ThreadingHTTPServer((args.bind, args.port), Handler)
    print(f"Serving {os.getcwd()} on http://{args.bind}:{args.port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()