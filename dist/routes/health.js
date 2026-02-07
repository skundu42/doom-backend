export async function registerHealthRoutes(fastify) {
    fastify.get("/health", async () => ({
        status: "ok",
        timestamp: new Date().toISOString()
    }));
}
