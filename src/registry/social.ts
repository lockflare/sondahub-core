import { Api, Row } from './types'
import { Rng, pastMs, iso, WORLD_NOW } from '../gen/prng'
import { later, person, resetUnique } from '../gen/helpers'
import { CITIES, COMMENT_LINES, HASHTAGS, LOREM, POST_CLOSERS, POST_OPENERS, POST_TOPICS } from '../gen/words'

export const socialApi: Api = {
  name: 'social',
  title: 'Social',
  tagline: 'A social network: users, posts, comments, likes and follows — the GraphQL one.',
  doc: 'Eight hundred users, four thousand posts, eight thousand comments and the likes and follows between them. Deeply related, which is what GraphQL is for: a user, the user’s posts, each post’s comments and the comment authors in one query.',
  collections: [
    {
      name: 'users',
      singular: 'user',
      doc: 'Members.',
      count: 800,
      preview: ['id', 'username', 'display_name', 'followers_count', 'posts_count', 'verified'],
      fields: [
        { name: 'username', type: 'string', required: true, example: 'camila_fernandez', doc: 'Unique handle.' },
        { name: 'display_name', type: 'string', required: true },
        { name: 'email', type: 'string' },
        { name: 'bio', type: 'text' },
        { name: 'avatar_url', type: 'string', doc: 'A generated SVG with the initials, served at this address.' },
        { name: 'location', type: 'string' },
        { name: 'website', type: 'string' },
        { name: 'verified', type: 'bool' },
        { name: 'private', type: 'bool' },
        { name: 'followers_count', type: 'int', readonly: true },
        { name: 'following_count', type: 'int', readonly: true },
        { name: 'posts_count', type: 'int', readonly: true },
        { name: 'joined_at', type: 'datetime' },
      ],
      relations: [
        { name: 'posts', kind: 'hasMany', collection: 'posts', field: 'author_id' },
        { name: 'comments', kind: 'hasMany', collection: 'comments', field: 'author_id' },
        { name: 'likes', kind: 'hasMany', collection: 'likes', field: 'user_id' },
        { name: 'followers', kind: 'hasMany', collection: 'follows', field: 'followee_id' },
        { name: 'following', kind: 'hasMany', collection: 'follows', field: 'follower_id' },
      ],
    },
    {
      name: 'posts',
      singular: 'post',
      doc: 'What people write. hashtags is an array; filter with ?hashtags_like=coffee.',
      count: 4000,
      sort: '-published_at',
      preview: ['id', 'author_id', 'body', 'likes_count', 'comments_count', 'published_at'],
      fields: [
        { name: 'author_id', type: 'ref', ref: 'users', required: true },
        { name: 'body', type: 'text', required: true },
        { name: 'hashtags', type: 'json', shape: 'string[]', search: true },
        { name: 'media', type: 'json', shape: '{ kind, url, alt? }[]' },
        { name: 'visibility', type: 'enum', values: ['public', 'followers', 'private'] },
        { name: 'reply_to_id', type: 'ref', ref: 'posts', doc: 'Set when the post is a reply.' },
        { name: 'likes_count', type: 'int', readonly: true },
        { name: 'comments_count', type: 'int', readonly: true },
        { name: 'reposts_count', type: 'int', readonly: true },
        { name: 'language', type: 'string', example: 'en' },
        { name: 'published_at', type: 'datetime' },
        { name: 'edited_at', type: 'datetime' },
      ],
      relations: [
        { name: 'author', kind: 'belongsTo', collection: 'users', field: 'author_id' },
        { name: 'comments', kind: 'hasMany', collection: 'comments', field: 'post_id' },
        { name: 'likes', kind: 'hasMany', collection: 'likes', field: 'post_id' },
        { name: 'reply_to', kind: 'belongsTo', collection: 'posts', field: 'reply_to_id' },
      ],
    },
    {
      name: 'comments',
      singular: 'comment',
      doc: 'Comments on posts; a comment can answer another comment through parent_id.',
      count: 8000,
      sort: '-created_at',
      preview: ['id', 'post_id', 'author_id', 'body', 'likes_count'],
      fields: [
        { name: 'post_id', type: 'ref', ref: 'posts', required: true },
        { name: 'author_id', type: 'ref', ref: 'users', required: true },
        { name: 'parent_id', type: 'ref', ref: 'comments' },
        { name: 'body', type: 'text', required: true },
        { name: 'likes_count', type: 'int', readonly: true },
        { name: 'flagged', type: 'bool' },
      ],
      relations: [
        { name: 'post', kind: 'belongsTo', collection: 'posts', field: 'post_id' },
        { name: 'author', kind: 'belongsTo', collection: 'users', field: 'author_id' },
        { name: 'parent', kind: 'belongsTo', collection: 'comments', field: 'parent_id' },
        { name: 'replies', kind: 'hasMany', collection: 'comments', field: 'parent_id' },
      ],
    },
    {
      name: 'likes',
      singular: 'like',
      doc: 'A user liking a post. POST one to like; DELETE it to unlike.',
      count: 8000,
      preview: ['id', 'user_id', 'post_id', 'created_at'],
      fields: [
        { name: 'user_id', type: 'ref', ref: 'users', required: true },
        { name: 'post_id', type: 'ref', ref: 'posts', required: true },
      ],
      relations: [
        { name: 'user', kind: 'belongsTo', collection: 'users', field: 'user_id' },
        { name: 'post', kind: 'belongsTo', collection: 'posts', field: 'post_id' },
      ],
    },
    {
      name: 'follows',
      singular: 'follow',
      doc: 'follower_id follows followee_id.',
      count: 5000,
      preview: ['id', 'follower_id', 'followee_id', 'status', 'created_at'],
      fields: [
        { name: 'follower_id', type: 'ref', ref: 'users', required: true },
        { name: 'followee_id', type: 'ref', ref: 'users', required: true },
        { name: 'status', type: 'enum', values: ['active', 'pending', 'blocked'] },
        { name: 'notifications', type: 'bool' },
      ],
      relations: [
        { name: 'follower', kind: 'belongsTo', collection: 'users', field: 'follower_id' },
        { name: 'followee', kind: 'belongsTo', collection: 'users', field: 'followee_id' },
      ],
    },
  ],
  feeds: [
    { topic: 'posts', doc: 'A new post from one of the seed users.', every: '5 s' },
    { topic: 'likes', doc: 'Someone liking something.', every: '2 s' },
  ],
}

export function generateSocial(): Record<string, Row[]> {
  resetUnique()
  const r = new Rng('social')
  const users: Row[] = []
  const handles = new Set<string>()
  for (let i = 1; i <= 800; i++) {
    const p = person(r)
    let username = p.username
    while (handles.has(username)) username = `${p.username}${r.int(2, 99)}`
    handles.add(username)
    const joined = pastMs(r, 1800, 3)
    const c = r.pick(CITIES)
    users.push({
      id: i,
      username,
      display_name: r.chance(0.8) ? p.name : p.first,
      email: p.email,
      bio: r.chance(0.7) ? `${r.pick(LOREM)}. ${r.pick(['Runner.', 'Cook.', 'Engineer.', 'Parent of two.', 'Coffee, mostly.', 'Recovering perfectionist.', 'Building things.', 'Here for the dogs.'])}` : null,
      avatar_url: `/v1/social/users/${i}/avatar.svg`,
      location: r.chance(0.6) ? `${c.city}, ${c.country}` : null,
      website: r.chance(0.2) ? `https://${username}.example.com` : null,
      verified: r.chance(0.04) ? 1 : 0,
      private: r.chance(0.12) ? 1 : 0,
      followers_count: 0,
      following_count: 0,
      posts_count: 0,
      joined_at: iso(joined),
      created_at: iso(joined),
      updated_at: iso(joined),
    })
  }

  const posts: Row[] = []
  for (let i = 1; i <= 4000; i++) {
    const author = users[r.int(0, users.length - 1)]
    const published = pastMs(r, 365, 0)
    const tags = r.some(HASHTAGS, r.weighted([[0, 40], [1, 35], [2, 18], [3, 7]] as const))
    const body = `${r.pick(POST_OPENERS)} ${r.pick(POST_TOPICS)}. ${r.pick(POST_CLOSERS)}${tags.length ? ' ' + tags.map((t) => '#' + t).join(' ') : ''}`
    const isReply = i > 200 && r.chance(0.15)
    posts.push({
      id: i,
      author_id: author.id,
      body,
      hashtags: JSON.stringify(tags),
      media: r.chance(0.25) ? JSON.stringify([{ kind: 'image', url: `/v1/social/posts/${i}/media/1.svg`, alt: r.pick(POST_TOPICS) }]) : JSON.stringify([]),
      visibility: (author.private as number) ? 'followers' : r.weighted([['public', 92], ['followers', 7], ['private', 1]] as const),
      reply_to_id: isReply ? r.int(1, i - 1) : null,
      likes_count: 0,
      comments_count: 0,
      reposts_count: r.weighted([[0, 70], [r.int(1, 5), 22], [r.int(6, 60), 8]] as const),
      language: r.weighted([['en', 75], ['es', 15], ['pt', 6], ['de', 4]] as const),
      published_at: iso(published),
      edited_at: r.chance(0.08) ? iso(later(published, r, 2, 600)) : null,
      created_at: iso(published),
      updated_at: iso(published),
    })
    ;(author.posts_count as number)++
  }

  const comments: Row[] = []
  for (let i = 1; i <= 8000; i++) {
    const post = posts[r.int(0, posts.length - 1)]
    const author = users[r.int(0, users.length - 1)]
    const at = later(Date.parse(post.published_at as string), r, 1, 60 * 24 * 10)
    const parent = i > 50 && r.chance(0.25) ? comments.find((c) => c.post_id === post.id) : undefined
    comments.push({
      id: i,
      post_id: post.id,
      author_id: author.id,
      parent_id: parent ? parent.id : null,
      body: r.pick(COMMENT_LINES),
      likes_count: r.weighted([[0, 60], [r.int(1, 4), 30], [r.int(5, 40), 10]] as const),
      flagged: r.chance(0.01) ? 1 : 0,
      created_at: iso(Math.min(at, WORLD_NOW)),
      updated_at: iso(Math.min(at, WORLD_NOW)),
    })
    ;(post.comments_count as number)++
  }

  const likes: Row[] = []
  const likeKeys = new Set<string>()
  let lid = 1
  while (lid <= 8000) {
    const post = posts[r.int(0, posts.length - 1)]
    const user = users[r.int(0, users.length - 1)]
    const key = `${user.id}:${post.id}`
    if (likeKeys.has(key)) continue
    likeKeys.add(key)
    const at = later(Date.parse(post.published_at as string), r, 1, 60 * 24 * 20)
    likes.push({ id: lid++, user_id: user.id, post_id: post.id, created_at: iso(Math.min(at, WORLD_NOW)), updated_at: iso(Math.min(at, WORLD_NOW)) })
    ;(post.likes_count as number)++
  }

  const follows: Row[] = []
  const followKeys = new Set<string>()
  let fid = 1
  while (fid <= 5000) {
    const a = users[r.int(0, users.length - 1)]
    const b = users[r.int(0, users.length - 1)]
    if (a.id === b.id) continue
    const key = `${a.id}:${b.id}`
    if (followKeys.has(key)) continue
    followKeys.add(key)
    const at = pastMs(r, 900, 0)
    const status = (b.private as number) ? r.weighted([['active', 70], ['pending', 30]] as const) : r.weighted([['active', 97], ['blocked', 3]] as const)
    follows.push({ id: fid++, follower_id: a.id, followee_id: b.id, status, notifications: r.chance(0.3) ? 1 : 0, created_at: iso(at), updated_at: iso(at) })
    if (status === 'active') {
      ;(a.following_count as number)++
      ;(b.followers_count as number)++
    }
  }

  return { users, posts, comments, likes, follows }
}
