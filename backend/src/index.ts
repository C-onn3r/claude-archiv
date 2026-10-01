import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (err) => {
        app.log.error(err);
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
  if (config.allowPrivateNetworks) app.log.warn('ALLOW_PRIVATE_NETWORKS ist aktiv: Proxy/Archiv dürfen interne Adressen erreichen.');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
