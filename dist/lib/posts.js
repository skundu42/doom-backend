function toAuthor(profile) {
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
function toBlocks(post) {
    const blocks = [];
    if (post.media_type === "video") {
        blocks.push({
            id: `video-${post.id}`,
            type: "video",
            url: post.media_url,
            thumbnail_url: post.thumbnail_url ?? undefined,
            caption: post.description
        });
    }
    else {
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
export function toApiPost(post, profile) {
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
export function countWords(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return 0;
    return trimmed.split(/\s+/).length;
}
