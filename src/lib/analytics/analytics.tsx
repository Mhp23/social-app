import React from 'react'
import {AppState, AppStateStatus} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {createClient, SegmentClient} from '@segment/analytics-react-native'
import {useSession, SessionAccount} from '#/state/session'
import {sha256} from 'js-sha256'
import {TrackEvent, AnalyticsMethods} from './types'
import {logger} from '#/logger'

type AppInfo = {
  build?: string | undefined
  name?: string | undefined
  namespace?: string | undefined
  version?: string | undefined
}

// Delay creating until first actual use.
let segmentClient: SegmentClient | null = null
function getClient(): SegmentClient {
  if (!segmentClient) {
    segmentClient = createClient({
      writeKey: '8I6DsgfiSLuoONyaunGoiQM7A6y2ybdI',
      trackAppLifecycleEvents: false,
      proxy: 'https://api.events.bsky.app/v1',
    })
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
  setupListenersOnce()

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

let didSetupListeners = false
function setupListenersOnce() {
  if (didSetupListeners) {
    return
  }
  didSetupListeners = true
  // NOTE
  // this is a copy of segment's own lifecycle event tracking
  // we handle it manually to ensure that it never fires while the app is backgrounded
  // -prf
  const client = getClient()
  client.isReady.onChange(async () => {
    if (AppState.currentState !== 'active') {
      logger.debug('Prevented a metrics ping while the app was backgrounded')
      return
    }
    const context = client.context.get()
    if (typeof context?.app === 'undefined') {
      logger.debug('Aborted metrics ping due to unavailable context')
      return
    }

    const oldAppInfo = await readAppInfo()
    const newAppInfo = context.app as AppInfo
    writeAppInfo(newAppInfo)
    logger.debug('Recording app info', {new: newAppInfo, old: oldAppInfo})

    if (typeof oldAppInfo === 'undefined') {
      client.track('Application Installed', {
        version: newAppInfo.version,
        build: newAppInfo.build,
      })
    } else if (newAppInfo.version !== oldAppInfo.version) {
      client.track('Application Updated', {
        version: newAppInfo.version,
        build: newAppInfo.build,
        previous_version: oldAppInfo.version,
        previous_build: oldAppInfo.build,
      })
    }
    client.track('Application Opened', {
      from_background: false,
      version: newAppInfo.version,
      build: newAppInfo.build,
    })
  })

  let lastState: AppStateStatus = AppState.currentState
  AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active' && lastState !== 'active') {
      const context = client.context.get()
      client.track('Application Opened', {
        from_background: true,
        version: context?.app?.version,
        build: context?.app?.build,
      })
    } else if (state !== 'active' && lastState === 'active') {
      client.track('Application Backgrounded')
    }
    lastState = state
  })
}

async function writeAppInfo(value: AppInfo) {
  await AsyncStorage.setItem('BSKY_APP_INFO', JSON.stringify(value))
}

async function readAppInfo(): Promise<AppInfo | undefined> {
  const rawData = await AsyncStorage.getItem('BSKY_APP_INFO')
  const obj = rawData ? JSON.parse(rawData) : undefined
  if (!obj || typeof obj !== 'object') {
    return undefined
  }
  return obj
}
