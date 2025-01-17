import React from 'react'
import {createClient} from '@segment/analytics-react'
import {sha256} from 'js-sha256'
import {TrackEvent, AnalyticsMethods} from './types'

import {useSession, SessionAccount} from '#/state/session'
import {logger} from '#/logger'

type SegmentClient = ReturnType<typeof createClient>

// Delay creating until first actual use.
let segmentClient: SegmentClient | null = null
function getClient(): SegmentClient {
  if (!segmentClient) {
    segmentClient = createClient(
      {
        writeKey: '8I6DsgfiSLuoONyaunGoiQM7A6y2ybdI',
      },
      {
        integrations: {
          'Segment.io': {
            apiHost: 'api.events.bsky.app/v1',
          },
        },
      },
    )
  }
  return segmentClient
}

export const track: TrackEvent = async (...args) => {
  await getClient().track(...args)
}

export function useAnalytics(): AnalyticsMethods {
  const {hasSession} = useSession()
  return React.useMemo(() => {
    if (hasSession) {
      return {
        async screen(...args) {
          await getClient().screen(...args)
        },
        async track(...args) {
          await getClient().track(...args)
        },
      }
    }
    // dont send analytics pings for anonymous users
    return {
      screen: async () => {},
      track: async () => {},
    }
  }, [hasSession])
}

export function init(account: SessionAccount | undefined) {
  if (account) {
    const client = getClient()
    if (account.did) {
      const did_hashed = sha256(account.did)
      client.identify(did_hashed, {did_hashed})
      logger.debug('Ping w/hash')
    } else {
      logger.debug('Ping w/o hash')
      client.identify()
    }
  }
}
