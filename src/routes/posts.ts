import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_VIDEO_DURATION_SECONDS } from "../config.js";
import { attachAuthUser, requireAuth } from "../lib/auth.js";
import {
  buildSignedPlaybackToken,
  getCloudflareVideo,
  resolvePlaybackUrls
} from "../lib/cloudflare.js";
import { countWords, type PostRow, toApiPost, toApiPostWithVideoPlayback } from "../lib/posts.js";
import { ensureProfile, type ProfileRow } from "../lib/profiles.js";
import { supabaseAdmin, unwrapData, unwrapOptionalData } from "../lib/supabase.js";

const createPostSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(800),
    topic: z.string().trim().min(1).max(48).optional(),
    location: z.string().trim().min(1).max(80).nullable().optional(),
    hashtags: z.array(z.string().trim().min(1).max(24)).max(20).optional(),
    media: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("image"),
        imageUrl: z.string().trim().url()
      }),
      z.object({
        type: z.literal("video"),
        cloudflareUid: z.string().trim().min(4).max(64)
      })
    ])
  })
  .strict();

const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(30).default(10),
  topic: z.string().trim().min(1).max(48).optional()
});

const postIdParamSchema = z.object({
  postId: z.string().uuid()
});

const userPostsParamSchema = z.object({
  userId: z.string().uuid()
});

const toggleLikeSchema = z
  .object({
    liked: z.boolean()
  })
  .strict();

const toggleSaveSchema = z
  .object({
    saved: z.boolean()
  })
  .strict();

const createCommentSchema = z
  .object({
    text: z.string().trim().min(1).max(500)
  })
  .strict();

const commentsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const feedCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid()
});

type FeedCursor = z.infer<typeof feedCursorSchema>;

type PostWithAuthorRow = PostRow & {
  author: ProfileRow | null;
};

type CommentAuthorRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

type CommentWithAuthorRow = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: CommentAuthorRow | null;
};

type VideoUploadOwnershipRow = {
  uid: string;
  user_id: string;
  status: string;
  duration_seconds: number | null;
};

const FEED_POST_SELECT = [
  "id",
  "author_id",
  "title",
  "description",
  "topic",
  "location",
  "hashtags",
  "media_type",
  "media_url",
  "thumbnail_url",
  "cloudflare_uid",
  "like_count",
  "bookmark_count",
  "view_count",
  "comment_count",
  "share_count",
  "created_at",
  "updated_at",
  "author:profiles!posts_author_id_fkey(id,username,display_name,bio,avatar_url,is_creator,links,interests,created_at,updated_at)"
].join(",");

const COMMENT_SELECT = [
  "id",
  "post_id",
  "author_id",
  "body",
  "created_at",
  "author:profiles!comments_author_id_fkey(id,username,display_name,avatar_url)"
].join(",");

function encodeCursor(cursor: FeedCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(rawCursor: string | undefined): FeedCursor | null {
  if (!rawCursor) return null;

  try {
    const decoded = Buffer.from(rawCursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    const validated = feedCursorSchema.safeParse(parsed);
    if (!validated.success) {
      return null;
    }
    return validated.data;
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: string) {
  return new Date(value).toISOString();
}

function applyKeysetPagination(query: any, cursor: FeedCursor | null) {
  if (!cursor) return query;
  return query.or(
    `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
  );
}

async function buildVideoPlaybackMap(rows: PostWithAuthorRow[]) {
  const entries = rows.filter((row) => row.media_type === "video" && row.cloudflare_uid);
  const playbackEntries = await Promise.all(
    entries.map(async (row) => {
      const uid = row.cloudflare_uid as string;
      const signedToken = await buildSignedPlaybackToken(uid);
      const playback = resolvePlaybackUrls({
        uid,
        signedToken
      });
      return [uid, { ...playback, signedToken }] as const;
    })
  );

  return new Map(playbackEntries);
}

async function fetchPostPage(params: {
  topic?: string;
  cursor: FeedCursor | null;
  limit: number;
  authorId?: string;
}) {
  let query = supabaseAdmin
    .from("posts")
    .select(FEED_POST_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(params.limit + 1);

  if (params.topic) {
    query = query.eq("topic", params.topic.toLowerCase());
  }

  if (params.authorId) {
    query = query.eq("author_id", params.authorId);
  }

  query = applyKeysetPagination(query, params.cursor);

  const result = await query;
  const rows = unwrapData<PostWithAuthorRow[]>(
    result as { data: PostWithAuthorRow[] | null; error: { message: string } | null },
    "Failed to load posts"
  );

  const hasNext = rows.length > params.limit;
  const pageRows = hasNext ? rows.slice(0, params.limit) : rows;
  const videoPlaybackByUid = await buildVideoPlaybackMap(pageRows);
  const nextCursor = hasNext
    ? encodeCursor({
        createdAt: normalizeTimestamp(pageRows[pageRows.length - 1]?.created_at ?? ""),
        id: pageRows[pageRows.length - 1]?.id ?? ""
      })
    : null;

  const items = pageRows
    .map((row) => {
      if (!row.author) return null;
      const videoPlayback = row.cloudflare_uid ? videoPlaybackByUid.get(row.cloudflare_uid) : undefined;
      return toApiPostWithVideoPlayback(row, row.author, videoPlayback);
    })
    .filter((item): item is NonNullable<typeof item> => item != null);

  return {
    items,
    nextCursor
  };
}

export async function registerPostRoutes(fastify: FastifyInstance) {
  fastify.register(async (app) => {
    app.get("/feed", async (request, reply) => {
      const parsed = paginationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const decodedCursor = decodeCursor(parsed.data.cursor);
      if (parsed.data.cursor && !decodedCursor) {
        return reply.status(400).send({ error: "Invalid cursor" });
      }

      const page = await fetchPostPage({
        topic: parsed.data.topic,
        cursor: decodedCursor,
        limit: parsed.data.limit
      });

      return {
        items: page.items,
        next_cursor: page.nextCursor
      };
    });

    app.get("/users/:userId/posts", async (request, reply) => {
      const parsedParams = userPostsParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({ error: parsedParams.error.flatten() });
      }

      const query = paginationQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.flatten() });
      }

      const decodedCursor = decodeCursor(query.data.cursor);
      if (query.data.cursor && !decodedCursor) {
        return reply.status(400).send({ error: "Invalid cursor" });
      }

      const page = await fetchPostPage({
        authorId: parsedParams.data.userId,
        cursor: decodedCursor,
        limit: query.data.limit
      });

      return {
        items: page.items,
        next_cursor: page.nextCursor
      };
    });

    app.post("/posts", { preHandler: requireAuth }, async (request, reply) => {
      const parsed = createPostSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      if (countWords(parsed.data.description) > 100) {
        return reply.unprocessableEntity("Description cannot exceed 100 words");
      }

      const author = await ensureProfile(request);
      const topic = parsed.data.topic?.toLowerCase() ?? "general";
      const hashtags = (parsed.data.hashtags ?? []).map((entry) => entry.toLowerCase().replace(/^#/, ""));

      let mediaUrl: string;
      let thumbnailUrl: string | null = null;
      let mediaType: "image" | "video" = "image";
      let cloudflareUid: string | null = null;

      if (parsed.data.media.type === "video") {
        mediaType = "video";
        cloudflareUid = parsed.data.media.cloudflareUid;
        const ownershipResult = await supabaseAdmin
          .from("video_uploads")
          .select("uid,user_id,status,duration_seconds")
          .eq("uid", cloudflareUid)
          .maybeSingle();
        const ownedUpload = unwrapOptionalData<VideoUploadOwnershipRow>(
          ownershipResult as {
            data: VideoUploadOwnershipRow | null;
            error: { code?: string; message: string } | null;
          }
        );

        if (!ownedUpload || ownedUpload.user_id !== author.id) {
          return reply.forbidden("Video upload does not belong to current user");
        }

        const video = await getCloudflareVideo(cloudflareUid);
        if (!video.readyToStream) {
          return reply.conflict("Video is still processing");
        }
        const durationSeconds = Math.round(video.duration ?? 0);
        if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
          return reply.unprocessableEntity("Video exceeds 3-minute limit");
        }

        const playback = resolvePlaybackUrls({
          uid: cloudflareUid,
          playback: video.playback,
          thumbnail: video.thumbnail
        });

        mediaUrl = playback.hls;
        thumbnailUrl = playback.thumbnail;
      } else {
        mediaType = "image";
        mediaUrl = parsed.data.media.imageUrl;
      }

      const insertResult = await supabaseAdmin
        .from("posts")
        .insert({
          author_id: author.id,
          title: parsed.data.title,
          description: parsed.data.description,
          topic,
          location: parsed.data.location ?? null,
          hashtags,
          media_type: mediaType,
          media_url: mediaUrl,
          thumbnail_url: thumbnailUrl,
          cloudflare_uid: cloudflareUid
        })
        .select(
          "id,author_id,title,description,topic,location,hashtags,media_type,media_url,thumbnail_url,cloudflare_uid,like_count,bookmark_count,view_count,comment_count,share_count,created_at,updated_at"
        )
        .single();

      const createdPost = unwrapData<PostRow>(
        insertResult as { data: PostRow | null; error: { message: string } | null },
        "Failed to create post"
      );

      const videoPlayback =
        createdPost.media_type === "video" && createdPost.cloudflare_uid
          ? await (async () => {
              const uid = createdPost.cloudflare_uid as string;
              const signedToken = await buildSignedPlaybackToken(uid);
              const playback = resolvePlaybackUrls({ uid, signedToken });
              return { ...playback, signedToken };
            })()
          : undefined;

      return {
        post: createdPost.media_type === "video"
          ? toApiPostWithVideoPlayback(createdPost, author, videoPlayback)
          : toApiPost(createdPost, author)
      };
    });

    app.post("/posts/:postId/likes", { preHandler: requireAuth }, async (request, reply) => {
      const params = postIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: params.error.flatten() });
      }

      const body = toggleLikeSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const authUser = request.authUser;
      if (!authUser) return reply.unauthorized("Missing authenticated user context");

      await ensureProfile(request);
      const toggleResult = await supabaseAdmin.rpc("toggle_post_like", {
        p_post_id: params.data.postId,
        p_user_id: authUser.id,
        p_like: body.data.liked
      });

      unwrapData<boolean>(
        toggleResult as { data: boolean | null; error: { message: string } | null },
        "Failed to toggle like"
      );

      return { ok: true };
    });

    app.post("/posts/:postId/saves", { preHandler: requireAuth }, async (request, reply) => {
      const params = postIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: params.error.flatten() });
      }

      const body = toggleSaveSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const authUser = request.authUser;
      if (!authUser) return reply.unauthorized("Missing authenticated user context");

      await ensureProfile(request);
      const toggleResult = await supabaseAdmin.rpc("toggle_post_save", {
        p_post_id: params.data.postId,
        p_user_id: authUser.id,
        p_save: body.data.saved
      });

      unwrapData<boolean>(
        toggleResult as { data: boolean | null; error: { message: string } | null },
        "Failed to toggle save"
      );

      return { ok: true };
    });

    app.post("/posts/:postId/share", { preHandler: requireAuth }, async (request, reply) => {
      const params = postIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: params.error.flatten() });
      }

      const incrementResult = await supabaseAdmin.rpc("increment_post_share", {
        p_post_id: params.data.postId
      });

      const shareCount = unwrapData<number>(
        incrementResult as { data: number | null; error: { message: string } | null },
        "Failed to increment share count"
      );

      return { ok: true, shareCount };
    });

    app.get("/posts/:postId/comments", async (request, reply) => {
      const params = postIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: params.error.flatten() });
      }

      const query = commentsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.flatten() });
      }

      const decodedCursor = decodeCursor(query.data.cursor);
      if (query.data.cursor && !decodedCursor) {
        return reply.status(400).send({ error: "Invalid cursor" });
      }

      let commentQuery = supabaseAdmin
        .from("comments")
        .select(COMMENT_SELECT)
        .eq("post_id", params.data.postId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(query.data.limit + 1);

      commentQuery = applyKeysetPagination(commentQuery, decodedCursor);

      const result = await commentQuery;
      const rows = unwrapData<CommentWithAuthorRow[]>(
        result as { data: CommentWithAuthorRow[] | null; error: { message: string } | null },
        "Failed to load comments"
      );

      const hasNext = rows.length > query.data.limit;
      const pageRows = hasNext ? rows.slice(0, query.data.limit) : rows;
      const nextCursor = hasNext
        ? encodeCursor({
            createdAt: normalizeTimestamp(pageRows[pageRows.length - 1]?.created_at ?? ""),
            id: pageRows[pageRows.length - 1]?.id ?? ""
          })
        : null;

      const comments = pageRows
        .map((entry) => {
          if (!entry.author) return null;
          return {
            id: entry.id,
            text: entry.body,
            created_at: entry.created_at,
            author: {
              id: entry.author.id,
              handle: entry.author.username,
              display_name: entry.author.display_name,
              avatar_url: entry.author.avatar_url
            }
          };
        })
        .filter((item): item is NonNullable<typeof item> => item != null);

      return {
        items: comments,
        next_cursor: nextCursor
      };
    });

    app.post("/posts/:postId/comments", { preHandler: requireAuth }, async (request, reply) => {
      const params = postIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: params.error.flatten() });
      }

      const body = createCommentSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const profile = await ensureProfile(request);
      const createResult = await supabaseAdmin.rpc("create_post_comment", {
        p_post_id: params.data.postId,
        p_author_id: profile.id,
        p_body: body.data.text
      });

      const rows = unwrapData<CommentWithAuthorRow[]>(
        createResult as { data: CommentWithAuthorRow[] | null; error: { message: string } | null },
        "Failed to create comment"
      );

      const created = rows[0];
      if (!created) {
        return reply.internalServerError("Comment was not created");
      }

      return {
        comment: {
          id: created.id,
          text: created.body,
          created_at: created.created_at,
          author: {
            id: profile.id,
            handle: profile.username,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url
          }
        }
      };
    });

    app.get("/me/likes", async (request, reply) => {
      const authUser = await attachAuthUser(request);
      if (!authUser) {
        return reply.unauthorized("Missing or invalid Supabase access token");
      }

      const result = await supabaseAdmin
        .from("post_likes")
        .select("post_id")
        .eq("user_id", authUser.id);

      const rows = unwrapData<Array<{ post_id: string }>>(
        result as { data: Array<{ post_id: string }> | null; error: { message: string } | null },
        "Failed to fetch likes"
      );

      return {
        postIds: rows.map((row) => row.post_id)
      };
    });

    app.get("/me/saves", async (request, reply) => {
      const authUser = await attachAuthUser(request);
      if (!authUser) {
        return reply.unauthorized("Missing or invalid Supabase access token");
      }

      const result = await supabaseAdmin
        .from("post_saves")
        .select("post_id")
        .eq("user_id", authUser.id);

      const rows = unwrapData<Array<{ post_id: string }>>(
        result as { data: Array<{ post_id: string }> | null; error: { message: string } | null },
        "Failed to fetch saves"
      );

      return {
        postIds: rows.map((row) => row.post_id)
      };
    });
  }, { prefix: "/v1" });
}
