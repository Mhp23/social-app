import * as React from 'react'
import {
  LayoutChangeEvent,
  FlatList,
  ScrollView,
  StyleSheet,
  View,
  NativeScrollEvent,
} from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
  runOnUI,
  scrollTo,
  useAnimatedRef,
  AnimatedRef,
  SharedValue,
} from 'react-native-reanimated'
import {Pager, PagerRef, RenderTabBarFnProps} from 'view/com/pager/Pager'
import {TabBar} from './TabBar'
import {useWebMediaQueries} from 'lib/hooks/useWebMediaQueries'
import {OnScrollHandler} from 'lib/hooks/useOnMainScroll'
import {useNonReactiveCallback} from '#/lib/hooks/useNonReactiveCallback'

const SCROLLED_DOWN_LIMIT = 200

export interface PagerWithHeaderChildParams {
  headerHeight: number
  isFocused: boolean
  onScroll: OnScrollHandler
  isScrolledDown: boolean
  scrollElRef: React.MutableRefObject<FlatList<any> | ScrollView | null>
}

export interface PagerWithHeaderProps {
  testID?: string
  children:
    | (((props: PagerWithHeaderChildParams) => JSX.Element) | null)[]
    | ((props: PagerWithHeaderChildParams) => JSX.Element)
  items: string[]
  isHeaderReady: boolean
  renderHeader?: () => JSX.Element
  initialPage?: number
  onPageSelected?: (index: number) => void
  onCurrentPageSelected?: (index: number) => void
}
export const PagerWithHeader = React.forwardRef<PagerRef, PagerWithHeaderProps>(
  function PageWithHeaderImpl(
    {
      children,
      testID,
      items,
      isHeaderReady,
      renderHeader,
      initialPage,
      onPageSelected,
      onCurrentPageSelected,
    }: PagerWithHeaderProps,
    ref,
  ) {
    const [currentPage, setCurrentPage] = React.useState(0)
    const [tabBarHeight, setTabBarHeight] = React.useState(0)
    const [headerOnlyHeight, setHeaderOnlyHeight] = React.useState(0)
    const [isScrolledDown, setIsScrolledDown] = React.useState(false)
    const scrollY = useSharedValue(0)
    const headerHeight = headerOnlyHeight + tabBarHeight

    // capture the header bar sizing
    const onTabBarLayout = React.useCallback(
      (evt: LayoutChangeEvent) => {
        const height = evt.nativeEvent.layout.height
        if (height > 0) {
          // The rounding is necessary to prevent jumps on iOS
          setTabBarHeight(Math.round(height))
        }
      },
      [setTabBarHeight],
    )
    const onHeaderOnlyLayout = React.useCallback(
      (evt: LayoutChangeEvent) => {
        const height = evt.nativeEvent.layout.height
        if (height > 0) {
          // The rounding is necessary to prevent jumps on iOS
          setHeaderOnlyHeight(Math.round(height))
        }
      },
      [setHeaderOnlyHeight],
    )

    const renderTabBar = React.useCallback(
      (props: RenderTabBarFnProps) => {
        return (
          <PagerTabBar
            headerOnlyHeight={headerOnlyHeight}
            items={items}
            isHeaderReady={isHeaderReady}
            renderHeader={renderHeader}
            currentPage={currentPage}
            onCurrentPageSelected={onCurrentPageSelected}
            onTabBarLayout={onTabBarLayout}
            onHeaderOnlyLayout={onHeaderOnlyLayout}
            onSelect={props.onSelect}
            scrollY={scrollY}
            testID={testID}
          />
        )
      },
      [
        headerOnlyHeight,
        items,
        isHeaderReady,
        renderHeader,
        currentPage,
        onCurrentPageSelected,
        onTabBarLayout,
        onHeaderOnlyLayout,
        scrollY,
        testID,
      ],
    )

    const scrollRefs = useSharedValue<AnimatedRef<any>[]>([])
    const registerRef = (scrollRef: AnimatedRef<any>, index: number) => {
      scrollRefs.modify(refs => {
        'worklet'
        refs[index] = scrollRef
        return refs
      })
    }

    const lastForcedScrollY = useSharedValue(0)
    const adjustScrollForOtherPages = () => {
      'worklet'
      const currentScrollY = scrollY.value
      const forcedScrollY = Math.min(currentScrollY, headerOnlyHeight)
      if (lastForcedScrollY.value !== forcedScrollY) {
        lastForcedScrollY.value = forcedScrollY
        const refs = scrollRefs.value
        for (let i = 0; i < refs.length; i++) {
          if (i !== currentPage) {
            // This needs to run on the UI thread.
            scrollTo(refs[i], 0, forcedScrollY, false)
          }
        }
      }
    }

    const throttleTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(
      null,
    )
    const queueThrottledOnScroll = useNonReactiveCallback(() => {
      if (!throttleTimeout.current) {
        throttleTimeout.current = setTimeout(() => {
          throttleTimeout.current = null

          runOnUI(adjustScrollForOtherPages)()

          const nextIsScrolledDown = scrollY.value > SCROLLED_DOWN_LIMIT
          if (isScrolledDown !== nextIsScrolledDown) {
            React.startTransition(() => {
              setIsScrolledDown(nextIsScrolledDown)
            })
          }
        }, 80 /* Sync often enough you're unlikely to catch it unsynced */)
      }
    })

    const onScrollWorklet = React.useCallback(
      (e: NativeScrollEvent) => {
        'worklet'
        const nextScrollY = e.contentOffset.y
        scrollY.value = nextScrollY
        runOnJS(queueThrottledOnScroll)()
      },
      [scrollY, queueThrottledOnScroll],
    )

    const onPageSelectedInner = React.useCallback(
      (index: number) => {
        setCurrentPage(index)
        onPageSelected?.(index)
      },
      [onPageSelected, setCurrentPage],
    )

    const onPageSelecting = React.useCallback((index: number) => {
      setCurrentPage(index)
    }, [])

    return (
      <Pager
        ref={ref}
        testID={testID}
        initialPage={initialPage}
        onPageSelected={onPageSelectedInner}
        onPageSelecting={onPageSelecting}
        renderTabBar={renderTabBar}
        tabBarPosition="top">
        {toArray(children)
          .filter(Boolean)
          .map((child, i) => {
            const isReady =
              isHeaderReady && headerOnlyHeight > 0 && tabBarHeight > 0
            return (
              <View key={i} collapsable={false}>
                <PagerItem
                  headerHeight={headerHeight}
                  isReady={isReady}
                  isFocused={i === currentPage}
                  isScrolledDown={isScrolledDown}
                  onScrollWorklet={i === currentPage ? onScrollWorklet : noop}
                  registerRef={(r: AnimatedRef<any>) => registerRef(r, i)}
                  renderTab={child}
                />
              </View>
            )
          })}
      </Pager>
    )
  },
)

let PagerTabBar = ({
  currentPage,
  headerOnlyHeight,
  isHeaderReady,
  items,
  scrollY,
  testID,
  renderHeader,
  onHeaderOnlyLayout,
  onTabBarLayout,
  onCurrentPageSelected,
  onSelect,
}: {
  currentPage: number
  headerOnlyHeight: number
  isHeaderReady: boolean
  items: string[]
  testID?: string
  scrollY: SharedValue<number>
  renderHeader?: () => JSX.Element
  onHeaderOnlyLayout: (e: LayoutChangeEvent) => void
  onTabBarLayout: (e: LayoutChangeEvent) => void
  onCurrentPageSelected?: (index: number) => void
  onSelect?: (index: number) => void
}): React.ReactNode => {
  const {isMobile} = useWebMediaQueries()
  const headerTransform = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: Math.min(Math.min(scrollY.value, headerOnlyHeight) * -1, 0),
      },
    ],
  }))
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        isMobile ? styles.tabBarMobile : styles.tabBarDesktop,
        headerTransform,
      ]}>
      <View onLayout={onHeaderOnlyLayout} pointerEvents="box-none">
        {renderHeader?.()}
      </View>
      <View
        onLayout={onTabBarLayout}
        style={{
          // Render it immediately to measure it early since its size doesn't depend on the content.
          // However, keep it invisible until the header above stabilizes in order to prevent jumps.
          opacity: isHeaderReady ? 1 : 0,
          pointerEvents: isHeaderReady ? 'auto' : 'none',
        }}>
        <TabBar
          testID={testID}
          items={items}
          selectedPage={currentPage}
          onSelect={onSelect}
          onPressSelected={onCurrentPageSelected}
        />
      </View>
    </Animated.View>
  )
}
PagerTabBar = React.memo(PagerTabBar)

function PagerItem({
  headerHeight,
  isReady,
  isFocused,
  isScrolledDown,
  onScrollWorklet,
  renderTab,
  registerRef,
}: {
  headerHeight: number
  isFocused: boolean
  isReady: boolean
  isScrolledDown: boolean
  registerRef: (scrollRef: AnimatedRef<any>) => void
  onScrollWorklet: (e: NativeScrollEvent) => void
  renderTab: ((props: PagerWithHeaderChildParams) => JSX.Element) | null
}) {
  const scrollElRef = useAnimatedRef()
  registerRef(scrollElRef)

  const scrollHandler = React.useMemo(
    () => ({onScroll: onScrollWorklet}),
    [onScrollWorklet],
  )

  if (!isReady || renderTab == null) {
    return null
  }

  return renderTab({
    headerHeight,
    isFocused,
    isScrolledDown,
    onScroll: scrollHandler,
    scrollElRef: scrollElRef as React.MutableRefObject<
      FlatList<any> | ScrollView | null
    >,
  })
}

const styles = StyleSheet.create({
  tabBarMobile: {
    position: 'absolute',
    zIndex: 1,
    top: 0,
    left: 0,
    width: '100%',
  },
  tabBarDesktop: {
    position: 'absolute',
    zIndex: 1,
    top: 0,
    // @ts-ignore Web only -prf
    left: 'calc(50% - 299px)',
    width: 598,
  },
})

function noop() {
  'worklet'
}

function toArray<T>(v: T | T[]): T[] {
  if (Array.isArray(v)) {
    return v
  }
  return [v]
}
