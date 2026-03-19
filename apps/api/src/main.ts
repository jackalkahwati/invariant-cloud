import 'dotenv/config';
import { buildApp } from './app.js';
import { serverConfig } from './infrastructure/config.js';

const app = await buildApp();
try {
  await app.listen({ port: serverConfig.port, host: serverConfig.host });
  app.log.info(`Invariant API running on ${serverConfig.host}:${serverConfig.port}`);
  app.log.info(`API Docs: http://localhost:${serverConfig.port}/docs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
