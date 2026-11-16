import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'refv-local-disk-db',
      configureServer(server) {
        server.middlewares.use('/api/db', (req, res) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
          }

          if (req.method === 'GET') {
            if (fs.existsSync(DB_FILE)) {
              try {
                const content = fs.readFileSync(DB_FILE, 'utf-8');
                res.statusCode = 200;
                res.end(content);
                return;
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(err) }));
                return;
              }
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ exists: false }));
            return;
          }

          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body);
                fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true, path: DB_FILE }));
              } catch (err) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
            return;
          }

          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        });
      },
    },
  ],
  base: './',
  server: {
    port: 5175,
    host: true,
  },
});
