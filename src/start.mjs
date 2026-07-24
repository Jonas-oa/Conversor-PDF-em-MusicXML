import { createApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";

const config = loadConfig();
const app = await createApp({ config, logger: true });
await app.listen({ host: config.host, port: config.port });
