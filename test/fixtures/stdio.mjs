import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../../src/server.mjs';
import { PageRegistry } from '../../src/registry.mjs';
import { Publisher } from '../../src/publisher.mjs';
import { FakeCloud, scope } from '../helpers.mjs';

// This executable is only started by the protocol tests with a fresh temporary directory.
const directory = process.env.TEST_STATE_DIR;
if (!directory) throw new Error('TEST_STATE_DIR required');
globalThis.fetch = async () => { throw new Error('Network access is prohibited in this fixture'); };
const file = join(directory, 'fake-cloud.json');
class PersistentFakeCloud extends FakeCloud {
  async deleteCurrent(key) {
    await super.deleteCurrent(key);
    await writeFile(file, JSON.stringify([...this.objects]));
    if (process.env.TEST_CRASH_STAGE === 'COS_DELETE') process.exit(23);
  }
  async deleteObjects(keys) {
    await super.deleteObjects(keys);
    await writeFile(file, JSON.stringify([...this.objects]));
  }
  async put(...args) {
    if (process.env.TEST_CRASH_STAGE === args[3]) process.exit(23);
    await super.put(...args);
    await writeFile(file, JSON.stringify([...this.objects]));
  }
}
const cloud = new PersistentFakeCloud();
try { cloud.objects = new Map(JSON.parse(await readFile(file, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
cloud.failAt = process.env.TEST_FAIL_STAGE;
const registry = new PageRegistry(join(directory, 'pages'), scope);
await createServer(() => new Publisher(cloud, cloud.fetch, registry)).connect(new StdioServerTransport());
