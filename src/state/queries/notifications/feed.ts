/**
 * NOTE
 * The ./unread.ts API:
 *
 * - Provides a `checkUnread()` function to sync with the server,
 * - Periodically calls `checkUnread()`, and
 * - Caches the first page of notifications.
 *
 * IMPORTANT: This query uses ./unread.ts's cache as its first page,
 * IMPORTANT: which means the cache-freshness of this query is driven by the unread API.
 *
 * Follow these rules:
 *
 * 1. Call `checkUnread()` if you want to fetch latest in the background.
 * 2. Call `checkUnread({invalidate: true})` if you want latest to sync into this query's results immediately.
 * 3. Don't call this query's `refetch()` if you're trying to sync latest; call `checkUnread()` instead.
 */

import {AppBskyFeedDefs} from '@atproto/api'
import {
  useInfiniteQuery,
  InfiniteData,
  QueryKey,
  useQueryClient,
  QueryClient,
} from '@tanstack/react-query'
import {useModerationOpts} from '../preferences'
import {useUnreadNotificationsApi} from './unread'
import {fetchPage} from './util'
import {FeedPage} from './types'
import {useMutedThreads} from '#/state/muted-threads'
import {STALE} from '..'
import {embedViewRecordToPostView, getEmbeddedPost} from '../util'

export type {NotificationType, FeedNotification, FeedPage} from './types'

const PAGE_SIZE = 30

type RQPageParam = string | undefined

export function RQKEY() {
  return ['notification-feed']
}

export function useNotificationFeedQuery(opts?: {enabled?: boolean}) {
  const queryClient = useQueryClient()
  const moderationOpts = useModerationOpts()
  const threadMutes = useMutedThreads()
  const unreads = useUnreadNotificationsApi()
  const enabled = opts?.enabled !== false

  return useInfiniteQuery<
    FeedPage,
    Error,
    InfiniteData<FeedPage>,
    QueryKey,
    RQPageParam
  >({
    staleTime: STALE.INFINITY,
    queryKey: RQKEY(),
    async queryFn({pageParam}: {pageParam: RQPageParam}) {
      let page
      if (!pageParam) {
        // for the first page, we check the cached page held by the unread-checker first
        page = unreads.getCachedUnreadPage()
      }
      if (!page) {
        page = await fetchPage({
          limit: PAGE_SIZE,
          cursor: pageParam,
          queryClient,
          moderationOpts,
          threadMutes,
        })
      }

      // if the first page has an unread, mark all read
      if (!pageParam && page.items[0] && !page.items[0].notification.isRead) {
        unreads.markAllRead()
      }

      return page
    },
    initialPageParam: undefined,
    getNextPageParam: lastPage => lastPage.cursor,
    enabled,
  })
}

/**
 * This helper is used by the post-thread placeholder function to
 * find a post in the query-data cache
 */
export function findPostInQueryData(
  queryClient: QueryClient,
  uri: string,
): AppBskyFeedDefs.PostView | undefined {
  const generator = findAllPostsInQueryData(queryClient, uri)
  const result = generator.next()
  if (result.done) {
    return undefined
  } else {
    return result.value
  }
}

export function* findAllPostsInQueryData(
  queryClient: QueryClient,
  uri: string,
): Generator<AppBskyFeedDefs.PostView, void> {
  const queryDatas = queryClient.getQueriesData<InfiniteData<FeedPage>>({
    queryKey: ['notification-feed'],
  })
  for (const [_queryKey, queryData] of queryDatas) {
    if (!queryData?.pages) {
      continue
    }
    for (const page of queryData?.pages) {
      for (const item of page.items) {
        if (item.subject?.uri === uri) {
          yield item.subject
        }
        const quotedPost = getEmbeddedPost(item.subject?.embed)
        if (quotedPost?.uri === uri) {
          yield embedViewRecordToPostView(quotedPost)
        }
      }
    }
  }
}
