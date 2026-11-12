import { createLedgerServer } from './app.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT ?? 3456);
const DB_PATH = process.env.DB_PATH ?? './ledger-server.db';
const CLIENT_DIST_DIR =
  process.env.CLIENT_DIST_DIR ?? resolve(__dirname, '../../client/dist');

const server = createLedgerServer({
  dbPath: DB_PATH,
  nodeId: process.env.NODE_ID ?? 'server-master',
  clientDistDir: CLIENT_DIST_DIR,
});

server
  .listen(PORT)
  .then(() => {
    console.log(`[LedgerServer] Running at http://localhost:${PORT}`);
    console.log(`[LedgerServer] DB path: ${DB_PATH}`);
    console.log(`[LedgerServer] Server Epoch ID: ${server.serverEpochId}`);
  })
  .catch((err) => {
    console.error('[LedgerServer] Failed to start:', err);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  console.log('[LedgerServer] Shutting down...');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[LedgerServer] Shutting down...');
  await server.close();
  process.exit(0);
});
