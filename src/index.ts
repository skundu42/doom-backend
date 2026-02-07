import { createServer } from "./server.js";
import { config } from "./config.js";

async function main() {
  const server = await createServer();

  try {
    await server.listen({ host: config.host, port: config.port });
  } catch (error) {
    server.log.error(error, "failed to start backend server");
    process.exit(1);
  }
}

void main();
