/**
 * @module domains/article-record
 * The shape of a LibreDesk article record as the article operations and folder sync write it.
 */

import { isRecord } from "../guards.js";

/**
 * Keys of LibreDesk's `ArticleRequest` that an update writes, except `collection_id` (moving is
 * `move`). `status` and `author_id` are not caller inputs but must be sent back: the update SQL
 * writes both, an empty status becomes `draft` and a missing author is cleared.
 */
export const ARTICLE_KEYS = [
  "slug",
  "locale",
  "title",
  "content",
  "excerpt",
  "meta_title",
  "meta_description",
  "meta_image_url",
  "sort_order",
  "status",
  "ai_enabled",
  "author_id",
] as const;

/** Collection id for article paths where LibreDesk looks the article up by id alone. */
export const NO_COLLECTION = 0;

/** Fields a write returns: enough to confirm it and chain the next call, without the content just sent. */
const WRITE_RESULT_KEYS = ["id", "collection_id", "title", "slug", "locale", "status", "ai_enabled", "updated_at"] as const;

/** The short result of an article write; `get` returns the whole article. Anything but a record passes through. */
export function presentArticleWrite(data: unknown): unknown {
  return isRecord(data) ? Object.fromEntries(WRITE_RESULT_KEYS.filter((key) => key in data).map((key) => [key, data[key]])) : data;
}
