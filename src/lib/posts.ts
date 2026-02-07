import type { ProfileRow } from "./profiles.js";
import type { StreamPlaybackUrls } from "./cloudflare.js";

export type PostRow = {
  id: string;
  author_id: string;
  title: string;
  description: string;
  topic: string;
  location: string | null;
  hashtags: string[] | null;
  media_type: "image" | "video";
  media_url: string;
  thumbnail_url: string | null;
  cloudflare_uid: string | null;
  like_count: number;
  bookmark_count: number;
  view_count: number;
  comment_count: number;
  share_count: number;
  created_at: string;
  updated_at: string;
};

type ApiBlock = {
  id: string;
  type: string;
  text?: string;
  items?: string[];
  url?: string;
  dash_url?: string;
  caption?: string;
  thumbnail_url?: string;
  signed_token?: string;
};

export type ApiPost = {
  id: string;
  author: {
    id: string;
    handle: string;
    display_name: string;
    bio: string | null;
    avatar_url: string | null;
    is_creator: boolean;
    links: string[];
    interests: string[];
  };
  title: string;
  blocks: ApiBlock[];
  topics: string[];
  created_at: string;
  updated_at: string;
  stats: {
    like_count: number;
    bookmark_count: number;
    view_count: number;
    comment_count: number;
    share_count: number;
  };
};

function toAuthor(profile: ProfileRow) {
  return {
    id: profile.id,
    handle: profile.username,
    display_name: profile.display_name,
    bio: profile.bio,
    avatar_url: profile.avatar_url,
    is_creator: profile.is_creator,
    links: profile.links ?? [],
    interests: profile.interests ?? []
  };
}

function toBlocks(post: PostRow, videoPlayback?: StreamPlaybackUrls & { signedToken?: string | null }): ApiBlock[] {
  const blocks: ApiBlock[] = [];
  if (post.media_type === "video") {
    blocks.push({
      id: `video-${post.id}`,
      type: "video",
      url: videoPlayback?.hls ?? post.media_url,
      dash_url: videoPlayback?.dash,
      thumbnail_url: videoPlayback?.thumbnail ?? post.thumbnail_url ?? undefined,
      caption: post.description,
      signed_token: videoPlayback?.signedToken ?? undefined
    });
  } else {
    blocks.push({
      id: `image-${post.id}`,
      type: "image",
      url: post.media_url,
      caption: post.description
    });
  }

  blocks.push({
    id: `heading-${post.id}`,
    type: "heading",
    text: post.title
  });
  blocks.push({
    id: `paragraph-${post.id}`,
    type: "paragraph",
    text: post.description
  });

  if (post.location) {
    blocks.push({
      id: `location-${post.id}`,
      type: "paragraph",
      text: `Location: ${post.location}`
    });
  }

  if (post.hashtags && post.hashtags.length > 0) {
    blocks.push({
      id: `tags-${post.id}`,
      type: "bullets",
      items: post.hashtags.map((entry) => `#${entry}`)
    });
  }

  return blocks;
}

export function toApiPost(post: PostRow, profile: ProfileRow): ApiPost {
  return {
    id: post.id,
    author: toAuthor(profile),
    title: post.title,
    blocks: toBlocks(post),
    topics: [post.topic, ...(post.hashtags ?? [])],
    created_at: post.created_at,
    updated_at: post.updated_at,
    stats: {
      like_count: post.like_count,
      bookmark_count: post.bookmark_count,
      view_count: post.view_count,
      comment_count: post.comment_count,
      share_count: post.share_count
    }
  };
}

export function toApiPostWithVideoPlayback(
  post: PostRow,
  profile: ProfileRow,
  videoPlayback?: StreamPlaybackUrls & { signedToken?: string | null }
): ApiPost {
  return {
    id: post.id,
    author: toAuthor(profile),
    title: post.title,
    blocks: toBlocks(post, videoPlayback),
    topics: [post.topic, ...(post.hashtags ?? [])],
    created_at: post.created_at,
    updated_at: post.updated_at,
    stats: {
      like_count: post.like_count,
      bookmark_count: post.bookmark_count,
      view_count: post.view_count,
      comment_count: post.comment_count,
      share_count: post.share_count
    }
  };
}

export function countWords(text: string) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}
