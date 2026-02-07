import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { config } from "./config.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerPostRoutes } from "./routes/posts.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export async function createServer() {
  const server = Fastify({
    logger: {
      level: config.isProd ? "info" : "debug"
    }
  });

  await server.register(sensible);
  await server.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true
  });

  server.get("/", async () => ({
    service: "doomscroll-backend",
    status: "ok"
  }));

  await registerHealthRoutes(server);
  await registerProfileRoutes(server);
  await registerMediaRoutes(server);
  await registerPostRoutes(server);
  await registerDeviceRoutes(server);
  await registerWebhookRoutes(server);

  return server;
}
