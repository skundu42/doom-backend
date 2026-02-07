# Doomscroll Backend

Fastify backend for Doomscroll with:
- Supabase Auth + Postgres metadata
- Cloudflare Stream for video upload/playback
- 3-minute hard video limit (server-enforced)

## 1. Prerequisites
- Node.js 20+
- Supabase project
- Cloudflare account with Stream enabled

## 2. Setup
1. Copy env:
   - `cp .env.example .env`
2. Fill env values in `backend/.env`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_STREAM_API_TOKEN`
   - Optional webhook/signing vars
3. Install deps:
   - `npm install`
4. Apply DB schema:
   - Open Supabase SQL editor and run `backend/supabase/schema.sql`
5. Run server:
   - `npm run dev`

Default API URL: `http://localhost:8787`

## 3. API Overview
Base prefix: `/v1`

### Health
- `GET /health`

### Profile
- `GET /v1/profile/me`
- `PUT /v1/profile/me`

### Feed + Posts
- `GET /v1/feed?cursor=<opaque_next_cursor>&limit=&topic=`
- `GET /v1/users/:userId/posts?cursor=<opaque_next_cursor>&limit=`
- `POST /v1/posts`
- `POST /v1/posts/:postId/likes`
- `POST /v1/posts/:postId/saves`
- `POST /v1/posts/:postId/share`
- `GET /v1/posts/:postId/comments?cursor=<opaque_next_cursor>&limit=`
- `POST /v1/posts/:postId/comments`
- `GET /v1/me/likes`
- `GET /v1/me/saves`

### Media
- `POST /v1/media/video/direct-upload`
- `GET /v1/media/video/:uid/status`

### Devices (push token registration)
- `POST /v1/devices/push-token`

### Webhooks
- `POST /v1/webhooks/cloudflare/stream`

## 4. Auth Model
All protected routes expect:
- `Authorization: Bearer <supabase_access_token>`

The backend validates tokens with Supabase Admin API (`auth.getUser`).

## 5. Video Upload Flow (Cloudflare Stream)
1. Client calls `POST /v1/media/video/direct-upload` with optional filename/mime.
2. Backend returns `{ uid, uploadUrl, maxDurationSeconds: 180 }`.
3. Client uploads raw video bytes directly to `uploadUrl` (no backend proxy).
4. Client polls `GET /v1/media/video/:uid/status` until `readyToStream=true`.
5. Client creates post with `media.type="video"` and `cloudflareUid`.
6. Backend validates duration again and rejects anything over 180s.

## 6. Post Create Payload
Image post:
```json
{
  "title": "Sunset run",
  "description": "Quick evening run by the lake.",
  "topic": "fitness",
  "hashtags": ["running", "sunset"],
  "location": "Austin",
  "media": {
    "type": "image",
    "imageUrl": "https://..."
  }
}
```

Video post:
```json
{
  "title": "3-minute recap",
  "description": "Release notes in under 3 minutes.",
  "topic": "kotlin",
  "media": {
    "type": "video",
    "cloudflareUid": "<stream_uid>"
  }
}
```

Constraints:
- `title` max 120 chars
- `description` max 100 words
- `media video` max 180 seconds
- pagination uses opaque keyset cursor returned by `next_cursor`

## 7. App Integration Steps (Android + iOS)
1. Replace mock auth usage with real Supabase auth session handling.
2. Pass current access token with every protected request.
3. Add new backend config in shared code (e.g. `BackendConfig(baseUrl)`), separate from old Supabase REST feed config.
4. On create-post screen:
   - For image: upload file to your chosen image storage and use resulting URL in `POST /v1/posts`.
   - For video: follow the Cloudflare direct upload flow above, then call `POST /v1/posts` with `cloudflareUid`.
5. Use `GET /v1/feed` and `GET /v1/users/:userId/posts` to hydrate feed/profile screens.
6. Wire like/save/share/comment actions to backend endpoints.
7. Register push token once user logs in using `POST /v1/devices/push-token`.

## 8. Production Checklist
- Restrict CORS to known app domains.
- Set `CLOUDFLARE_STREAM_WEBHOOK_SECRET` and verify webhook header.
- Rotate service keys and API tokens.
- Put backend behind TLS + WAF.
- Add background worker for push dispatch and moderation.
