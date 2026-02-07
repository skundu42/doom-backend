import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { ensureProfile, updateOwnProfile } from "../lib/profiles.js";
const usernameRegex = /^[a-z0-9_]{3,24}$/;
const profilePatchSchema = z
    .object({
    username: z
        .string()
        .trim()
        .min(3)
        .max(24)
        .regex(usernameRegex, "username can only contain lowercase letters, numbers, and underscores")
        .optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    bio: z.string().trim().max(160).nullable().optional(),
    avatarUrl: z.string().trim().url().nullable().optional(),
    links: z.array(z.string().trim().url()).max(8).optional(),
    interests: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
    isCreator: z.boolean().optional()
})
    .strict();
export async function registerProfileRoutes(fastify) {
    fastify.register(async (app) => {
        app.get("/me", { preHandler: requireAuth }, async (request) => {
            const profile = await ensureProfile(request);
            return { profile };
        });
        app.put("/me", { preHandler: requireAuth }, async (request, reply) => {
            const parsed = profilePatchSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }
            const authUser = request.authUser;
            if (!authUser) {
                return reply.unauthorized("Missing authenticated user context");
            }
            await ensureProfile(request);
            const patch = parsed.data;
            const profile = await updateOwnProfile(authUser.id, {
                username: patch.username,
                display_name: patch.displayName,
                bio: patch.bio,
                avatar_url: patch.avatarUrl,
                links: patch.links,
                interests: patch.interests,
                is_creator: patch.isCreator
            });
            return { profile };
        });
    }, { prefix: "/v1/profile" });
}
