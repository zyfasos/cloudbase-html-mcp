import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../../src/server.mjs';

await createServer(() => {
  const secret = process.env.TEST_SECRET_MARKER;
  throw Object.assign(new TypeError(`synthetic message ${secret}`), {
    code: secret,
    cause: Object.assign(new Error(secret), { code: 'EACCES' }),
  });
}).connect(new StdioServerTransport());
