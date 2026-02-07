import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      id: string;
      email: string | null;
      userMetadata: Record<string, unknown>;
    };
  }
}
