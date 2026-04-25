const assert = require('node:assert/strict');

const {
  shouldRemoveCardBySignals,
  isBlockedStatus,
  findHideStatusMenu,
  getMenuBackKey,
  getFeedScrollerRuntime,
  resolveCurrentGroupId,
  cleanFeedWithRuntime,
  findRemovalTarget,
  cleanFeedWithScrollerRuntime,
  repairDuplicateScrollerItems,
  startCleaner,
} = require('./weibo-clean-feed.user.js');

const labelCases = [
  {
    name: 'removes cards tagged as recommended',
    input: {
      headerText: '微天下 推荐 23小时前 来自 微博视频号',
      tagTexts: ['推荐'],
      titleTexts: [],
      ariaLabels: [],
    },
    expected: true,
  },
  {
    name: 'removes cards tagged as advertisement',
    input: {
      headerText: '广告 1分钟前 来自 微博网页版',
      tagTexts: ['广告'],
      titleTexts: ['广告'],
      ariaLabels: [],
    },
    expected: true,
  },
  {
    name: 'keeps normal cards even if body text mentions advertisement',
    input: {
      headerText: '包容万物恒河水 6分钟前 来自 微博网页版',
      tagTexts: [],
      titleTexts: [],
      ariaLabels: [],
      bodyText: '这条微博正文里提到了广告法，但它不是广告卡片。',
    },
    expected: false,
  },
  {
    name: 'removes cards tagged as editorial picks',
    input: {
      headerText: 'Account \\u8350\\u8bfb 23h',
      tagTexts: ['\u8350\u8bfb'],
      titleTexts: [],
      ariaLabels: [],
    },
    expected: true,
  },
  {
    name: 'removes cards when editorial-picks badge is merged with header metadata text',
    input: {
      headerText: '大猪蹄子研究所 荐读 昨天 10:38',
      tagTexts: ['荐读 昨天 10:38'],
      titleTexts: [],
      ariaLabels: [],
    },
    expected: true,
  },
  {
    name: 'keeps normal cards when account names merely contain recommendation words',
    input: {
      headerText: '推荐电影君 昨天 10:38',
      tagTexts: ['推荐电影君'],
      titleTexts: [],
      ariaLabels: [],
    },
    expected: false,
  },
];

for (const { name, input, expected } of labelCases) {
  const actual = shouldRemoveCardBySignals(input);
  assert.equal(actual, expected, name);
}

function createStubCard({
  index = null,
  headerText = '',
  tagTexts = [],
  titleTexts = [],
  ariaLabels = [],
  inVirtualScroller = true,
} = {}) {
  const header = {
    textContent: headerText,
    querySelectorAll(selector) {
      if (selector === '*') {
        return tagTexts.map((text) => ({ textContent: text }));
      }

      if (selector === '[title]') {
        return titleTexts.map((title) => ({
          getAttribute(name) {
            return name === 'title' ? title : null;
          },
        }));
      }

      if (selector === '[aria-label]') {
        return ariaLabels.map((label) => ({
          getAttribute(name) {
            return name === 'aria-label' ? label : null;
          },
        }));
      }

      return [];
    },
  };

  return {
    querySelector(selector) {
      return selector === 'header' ? header : null;
    },
    closest(selector) {
      if (selector === '.vue-recycle-scroller__item-view') {
        return inVirtualScroller ? { className: 'vue-recycle-scroller__item-view' } : null;
      }

      if (selector === '.wbpro-scroller-item') {
        return index === null ? null : { dataset: { index: String(index) } };
      }

      return null;
    },
  };
}

function createComponent({
  name = '',
  proxy = null,
  children = [],
} = {}) {
  const component = {
    type: name ? { name } : {},
    proxy,
    subTree: {
      children: children.map((child) => ({ component: child })),
    },
  };

  return component;
}

function createScrollerItemElement(index) {
  return {
    dataset: { index: String(index) },
  };
}

assert.equal(
  findRemovalTarget(createStubCard({ index: 2 }), { allowVirtual: true }),
  null,
  'never directly removes cards inside virtual scroller views',
);

{
  const forceUpdateCalls = [];
  const items = [
    { idstr: '1', text_raw: 'normal' },
    { idstr: '2', text_raw: 'editorial card' },
    { idstr: '3', text_raw: 'normal 2' },
  ];

  const removedCount = cleanFeedWithScrollerRuntime(
    {
      dynamicScroller: {
        items,
        forceUpdate(arg) {
          forceUpdateCalls.push(arg);
        },
      },
    },
    {
      querySelectorAll(selector) {
        if (selector !== 'article.woo-panel-main') {
          return [];
        }

        return [
          createStubCard({
            index: 1,
            headerText: 'Account editorial picks',
            tagTexts: ['\u8350\u8bfb'],
          }),
        ];
      },
    },
  );

  assert.equal(removedCount, 1, 'removes blocked virtual-scroller cards by their scroller index');
  assert.deepEqual(items.map((item) => item.idstr), ['1', '3'], 'splices the matching scroller item out of the backing array');
  assert.deepEqual(forceUpdateCalls, [true], 'clears virtual-scroller size caches after removing a scroller item');
}

{
  const forceUpdateCalls = [];
  const updateSizeCalls = [];
  const handleScrollCalls = [];
  const items = [
    { idstr: '1', text_raw: 'normal' },
    { idstr: '2', text_raw: 'editorial card' },
    { idstr: '3', text_raw: 'normal 2' },
  ];
  const activeItemProxy = {
    finalActive: true,
    updateSize() {
      updateSizeCalls.push('active');
    },
  };
  const inactiveItemProxy = {
    finalActive: false,
    updateSize() {
      updateSizeCalls.push('inactive');
    },
  };
  const scrollerRoot = createComponent({
    name: 'DynamicScroller',
    proxy: null,
    children: [
      createComponent({ name: 'DynamicScrollerItem', proxy: activeItemProxy }),
      createComponent({ name: 'DynamicScrollerItem', proxy: inactiveItemProxy }),
    ],
  });
  const scheduled = [];
  const win = {
    clearTimeout() {},
    setTimeout(fn) {
      scheduled.push(fn);
      fn();
      return scheduled.length;
    },
  };

  const removedCount = cleanFeedWithScrollerRuntime(
    {
      dynamicScroller: {
        _: scrollerRoot,
        items,
        forceUpdate(arg) {
          forceUpdateCalls.push(arg);
        },
      },
      recycleScroller: {
        handleScroll() {
          handleScrollCalls.push('scroll');
        },
      },
    },
    {
      querySelectorAll(selector) {
        if (selector !== 'article.woo-panel-main') {
          return [];
        }

        return [
          createStubCard({
            index: 1,
            headerText: 'Account editorial picks',
            tagTexts: ['\u8350\u8bfb'],
          }),
        ];
      },
    },
    win,
  );

  assert.equal(removedCount, 1, 'removes the blocked item before repairing the visible scroller layout');
  assert.deepEqual(forceUpdateCalls, [true], 'clears virtual-scroller size caches before remeasuring active cards');
  assert.deepEqual(updateSizeCalls, ['active', 'active'], 'remeasures only active scroller items across repair passes');
  assert.deepEqual(handleScrollCalls, ['scroll', 'scroll'], 'nudges the recycle scroller after each repair pass');
}

{
  const forceUpdateCalls = [];
  const items = [
    { idstr: '1', text_raw: 'normal' },
    { idstr: '2', mark: '3_reallog_mark_ad:8|abc', text_raw: 'blank ad' },
    { idstr: '3', text_raw: 'normal 2' },
  ];

  const removedCount = cleanFeedWithScrollerRuntime(
    {
      dynamicScroller: {
        items,
        forceUpdate(arg) {
          forceUpdateCalls.push(arg);
        },
      },
    },
    {
      querySelectorAll() {
        return [];
      },
    },
  );

  assert.equal(removedCount, 1, 'repairs blank scroller slots by removing marked ad items even without a visible card');
  assert.deepEqual(items.map((item) => item.idstr), ['1', '3'], 'removes marked ad items from the scroller backing array');
  assert.deepEqual(forceUpdateCalls, [true], 'forces a virtual-scroller reflow when repairing blank slots');
}

{
  const forceUpdateCalls = [];
  const items = [
    { idstr: '1', text_raw: 'normal 1' },
    { idstr: '2', text_raw: 'duplicated status' },
    { idstr: '2', text_raw: 'duplicated status' },
    { idstr: '3', text_raw: 'normal 3' },
  ];

  const removedCount = cleanFeedWithScrollerRuntime(
    {
      dynamicScroller: {
        items,
        forceUpdate(arg) {
          forceUpdateCalls.push(arg);
        },
      },
    },
    {
      querySelectorAll() {
        return [];
      },
    },
  );

  assert.equal(removedCount, 1, 'removes duplicate non-ad items when the virtual scroller backing array drifts out of sync');
  assert.deepEqual(items.map((item) => item.idstr), ['1', '2', '3'], 'keeps the first occurrence and removes later duplicate scroller entries by status id');
  assert.deepEqual(forceUpdateCalls, [true], 'forces a virtual-scroller reflow after repairing duplicated scroller items');
}

{
  const forceUpdateCalls = [];
  const items = [
    { idstr: '1', text_raw: 'normal 1' },
    { idstr: '2', text_raw: 'duplicated status' },
    { idstr: '2', text_raw: 'duplicated status' },
    { idstr: '3', text_raw: 'normal 3' },
  ];

  const removedCount = repairDuplicateScrollerItems(
    {
      dynamicScroller: {
        items,
        forceUpdate(arg) {
          forceUpdateCalls.push(arg);
        },
      },
    },
  );

  assert.equal(removedCount, 1, 'repairs duplicate scroller entries directly without needing to run the full scroller cleanup');
  assert.deepEqual(items.map((item) => item.idstr), ['1', '2', '3'], 'duplicate-only repair keeps the first occurrence and removes later duplicates by status id');
  assert.deepEqual(forceUpdateCalls, [true], 'duplicate-only repair still forces a virtual-scroller reflow');
}

{
  const staleDynamicScroller = { items: [{ idstr: 'stale-1' }, { idstr: 'stale-2' }] };
  const correctDynamicScroller = { items: Array.from({ length: 27 }, (_, index) => ({ idstr: String(index + 1) })) };
  const recycleScroller = { handleScroll() {} };
  const rootComponent = createComponent({
    children: [
      createComponent({ name: 'DynamicScroller', proxy: staleDynamicScroller }),
      createComponent({ name: 'DynamicScroller', proxy: correctDynamicScroller }),
      createComponent({ name: 'RecycleScroller', proxy: recycleScroller }),
    ],
  });
  const doc = {
    querySelector(selector) {
      if (selector === '#app') {
        return {
          __vue_app__: {
            _container: {
              _vnode: {
                component: rootComponent,
              },
            },
          },
        };
      }

      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.wbpro-scroller-item') {
        return [createScrollerItemElement(2), createScrollerItemElement(8)];
      }

      return [];
    },
    body: null,
  };
  const win = {
    __weiboFeedCleanerScrollerRuntime__: {
      dynamicScroller: staleDynamicScroller,
      recycleScroller: null,
    },
  };

  const runtime = getFeedScrollerRuntime(doc, win);
  assert.equal(runtime.dynamicScroller, correctDynamicScroller, 'refreshes a stale cached scroller runtime when it cannot cover visible feed indexes');
  assert.equal(win.__weiboFeedCleanerScrollerRuntime__.dynamicScroller, correctDynamicScroller, 'replaces the cached scroller runtime with the valid feed scroller');
  assert.equal(runtime.recycleScroller, recycleScroller, 'keeps the recycle scroller needed for repair passes');
}

assert.equal(
  isBlockedStatus({ isAd: 1, promotion: { type: 'ad' } }),
  true,
  'treats Weibo ad statuses as blocked runtime items',
);
assert.equal(
  isBlockedStatus({ isAd: 0, promotion: null, readtimetype: 'normal' }),
  false,
  'does not block ordinary runtime statuses',
);

const hideMenu = findHideStatusMenu({
  mblog_menus_new: [
    { type: 'mblog_menus_report', name: '投诉' },
    { type: 'mblog_menus_hide_status', name: '不感兴趣', actionlog: { code: '50000003' } },
  ],
});

assert.deepEqual(
  hideMenu,
  { type: 'mblog_menus_hide_status', name: '不感兴趣', actionlog: { code: '50000003' } },
  'prefers the official hide-status menu entry exposed by Weibo runtime',
);

assert.equal(getMenuBackKey({ name: '不感兴趣' }), '1', 'maps dislike feedback to menu key 1');
assert.equal(getMenuBackKey({ name: '屏蔽此博主' }), '2', 'maps author shield feedback to menu key 2');
assert.equal(getMenuBackKey({ name: '投诉' }), '', 'ignores menu items that do not have feedback keys');

assert.equal(
  resolveCurrentGroupId(
    'https://weibo.com/mygroups?gid=110006764611163',
    { '110006764611163': { statuses: [] } },
    {},
  ),
  '110006764611163',
  'prefers the gid in the current URL when it matches cached latest-list data',
);
assert.equal(
  resolveCurrentGroupId(
    'https://weibo.com/',
    { fallback: { statuses: [] } },
    {},
  ),
  'fallback',
  'falls back to the first cached group when the URL has no gid',
);

const calls = [];
const statuses = [
  { idstr: '1', isAd: 0, text_raw: 'normal' },
  {
    idstr: '2',
    isAd: 1,
    text_raw: 'ad',
    mblog_menus_new: [
      {
        type: 'mblog_menus_hide_status',
        name: '不感兴趣',
        actionlog: { code: '50000003', mid: '2' },
      },
    ],
    extra_button_info: {
      actionlog: { code: '50000043', mid: '2' },
    },
    promotion: { type: 'ad' },
    readtimetype: 'adMblog',
  },
  { idstr: '3', isAd: 0, text_raw: 'normal 2' },
];

const runtime = {
  locationHref: 'https://weibo.com/mygroups?gid=110006764611163',
  store: {
    state: {
      feed: {
        latestList: {
          '110006764611163': {
            statuses,
          },
        },
      },
    },
  },
  http: {
    post(url, payload) {
      calls.push({ url, payload });
      return Promise.resolve({ data: { ok: 1, title: '操作成功' } });
    },
  },
};

const removedCount = cleanFeedWithRuntime(runtime);

assert.equal(removedCount, 1, 'removes one ad status from the active feed list');
assert.deepEqual(
  statuses.map((status) => status.idstr),
  ['1', '3'],
  'removes the ad from the backing statuses array instead of touching DOM placeholders',
);
assert.deepEqual(
  calls,
  [
    {
      url: '/ajax/feed/throwbatch',
      payload: { actionlog: { code: '50000003', mid: '2' } },
    },
    {
      url: '/ajax/feed/menuback',
      payload: { menu_key: '1', mid: '2' },
    },
  ],
  'replays Weibo runtime reporting endpoints before removing the ad item',
);

{
  const calls = [];
  const currentStatuses = [
    { idstr: '1', isAd: 0, text_raw: 'current normal' },
  ];
  const secondaryStatuses = [
    {
      idstr: '9',
      isAd: 1,
      text_raw: 'secondary ad',
      mblog_menus_new: [
        {
          type: 'mblog_menus_hide_status',
          name: '不感兴趣',
          actionlog: { code: '50000003', mid: '9' },
        },
      ],
      promotion: { type: 'ad' },
      readtimetype: 'adMblog',
    },
  ];

  const runtime = {
    locationHref: 'https://weibo.com/mygroups?gid=current',
    store: {
      state: {
        feed: {
          latestList: {
            current: {
              statuses: currentStatuses,
            },
            secondary: {
              statuses: secondaryStatuses,
            },
          },
        },
      },
    },
    http: {
      post(url, payload) {
        calls.push({ url, payload });
        return Promise.resolve({ data: { ok: 1 } });
      },
    },
  };

  const removedCount = cleanFeedWithRuntime(runtime);

  assert.equal(removedCount, 1, 'removes ads from any cached feed bucket instead of relying on a single guessed gid');
  assert.deepEqual(
    currentStatuses.map((status) => status.idstr),
    ['1'],
    'leaves unrelated current-bucket statuses untouched',
  );
  assert.deepEqual(
    secondaryStatuses.map((status) => status.idstr),
    [],
    'removes blocked statuses from secondary cached buckets so the scroller cannot rehydrate them on the next pass',
  );
  assert.deepEqual(
    calls,
    [
      {
        url: '/ajax/feed/throwbatch',
        payload: { actionlog: { code: '50000003', mid: '9' } },
      },
      {
        url: '/ajax/feed/menuback',
        payload: { menu_key: '1', mid: '9' },
      },
    ],
    'reports hidden secondary-bucket ads through Weibo runtime before removing them from cache',
  );
}

{
  const listeners = new Map();
  const observedTargets = [];
  const observerCallbacks = [];
  const timeoutCallbacks = [];
  const cleanCalls = [];
  const interactionRepairCalls = [];
  const clearedTimeouts = [];
  let expandedCommentsOpen = false;
  const feedMutationTarget = {
    nodeType: 1,
    matches(selector) {
      return selector.includes('.wbpro-scroller-item');
    },
    closest(selector) {
      return selector.includes('.wbpro-scroller-item') ? this : null;
    },
  };
  const doc = {
    activeElement: null,
    body: { nodeType: 1 },
    querySelector(selector) {
      if (expandedCommentsOpen && selector.includes('[aria-expanded="true"]')) {
        return { selector };
      }

      return null;
    },
  };
  const win = {
    MutationObserver: class {
      constructor(callback) {
        observerCallbacks.push(callback);
      }

      observe(target, options) {
        observedTargets.push({ target, options });
      }
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    setInterval(handler) {
      throw new Error('setInterval should not be used when MutationObserver is available');
    },
    setTimeout(handler, delay) {
      timeoutCallbacks.push({ handler, delay });
      return timeoutCallbacks.length;
    },
    clearTimeout(timeoutId) {
      clearedTimeouts.push(timeoutId);
    },
  };

  const cleanerHandle = startCleaner(doc, 1000, win, () => {
    cleanCalls.push('clean');
  }, () => {
    interactionRepairCalls.push('repair');
    return 1;
  });

  assert.equal(cleanerHandle.intervalId, null, 'does not rely on the polling interval when MutationObserver is available');
  assert.equal(Boolean(cleanerHandle.observer), true, 'installs a mutation observer to react to feed changes');
  assert.equal(observedTargets.length, 1, 'starts observing the feed root for reactive cleanup triggers');
  assert.deepEqual(cleanCalls, ['clean'], 'runs one initial clean immediately when the cleaner starts');
  assert.equal(typeof listeners.get('wheel'), 'function', 'listens to wheel activity to avoid mutating the virtual list mid-scroll');
  assert.equal(typeof listeners.get('scroll'), 'function', 'listens to scroll activity to defer list mutations until scrolling settles');
  assert.equal(typeof listeners.get('pointerdown'), 'function', 'tracks pointer interactions so comment toggles can finish before feed mutations resume');
  assert.equal(typeof listeners.get('click'), 'function', 'tracks click interactions such as opening comments before running deferred cleanup');

  observerCallbacks[0]([
    {
      type: 'childList',
      target: feedMutationTarget,
      addedNodes: [feedMutationTarget],
      removedNodes: [],
    },
  ]);

  assert.deepEqual(cleanCalls, ['clean'], 'waits for mutation batches to settle before cleaning after feed changes');
  assert.deepEqual(clearedTimeouts, [], 'does not clear a timer before the first scroll-idle debounce starts');
  assert.equal(timeoutCallbacks[0].delay, 60, 'uses a short mutation-settle debounce before cleaning the updated feed');

  timeoutCallbacks[0].handler();

  assert.deepEqual(cleanCalls, ['clean', 'clean'], 'reactively cleans the feed after a relevant list mutation');

  listeners.get('wheel')();
  observerCallbacks[0]([
    {
      type: 'childList',
      target: feedMutationTarget,
      addedNodes: [feedMutationTarget],
      removedNodes: [],
    },
  ]);

  assert.equal(timeoutCallbacks[2].delay, 60, 'still debounces mutation-driven cleanups while the user is interacting');
  timeoutCallbacks[2].handler();

  assert.deepEqual(cleanCalls, ['clean', 'clean'], 'defers mutation-driven cleaning while scroll input is active');
  assert.deepEqual(interactionRepairCalls, ['repair'], 'repairs duplicated scroller items even while scroll interaction is still active');
  assert.deepEqual(clearedTimeouts, [], 'does not clear the interaction timer until another interaction event arrives');

  listeners.get('scroll')();

  assert.deepEqual(clearedTimeouts, [2], 'refreshes the idle debounce when scrolling continues');
  timeoutCallbacks[3].handler();

  assert.deepEqual(cleanCalls, ['clean', 'clean', 'clean'], 'runs the deferred mutation cleanup once scrolling becomes idle again');

  listeners.get('click')();
  observerCallbacks[0]([
    {
      type: 'childList',
      target: feedMutationTarget,
      addedNodes: [feedMutationTarget],
      removedNodes: [],
    },
  ]);

  assert.deepEqual(cleanCalls, ['clean', 'clean', 'clean'], 'defers mutation-driven cleaning while a click interaction such as opening comments is still settling');
  assert.equal(timeoutCallbacks[4].delay, 900, 'uses a longer idle debounce for click-driven UI expansion like comments');
  assert.equal(timeoutCallbacks[5].delay, 60, 'still debounces feed mutations before applying the deferred click-triggered cleanup');
  timeoutCallbacks[5].handler();

  assert.deepEqual(cleanCalls, ['clean', 'clean', 'clean'], 'does not run the deferred clean until the click interaction itself becomes idle');
  assert.deepEqual(interactionRepairCalls, ['repair', 'repair'], 'keeps allowing duplicate-only repairs while click-driven interactions are active');
  timeoutCallbacks[4].handler();

  assert.deepEqual(cleanCalls, ['clean', 'clean', 'clean', 'clean'], 'runs the deferred clean after the click interaction becomes idle');

  expandedCommentsOpen = true;
  observerCallbacks[0]([
    {
      type: 'childList',
      target: feedMutationTarget,
      addedNodes: [feedMutationTarget],
      removedNodes: [],
    },
  ]);

  timeoutCallbacks[6].handler();

  assert.deepEqual(cleanCalls, ['clean', 'clean', 'clean', 'clean'], 'keeps deferring cleanup while a comment section remains expanded after the click has already finished');
  assert.deepEqual(interactionRepairCalls, ['repair', 'repair', 'repair'], 'runs duplicate-only repair when feed mutations land during an expanded comment interaction');
  assert.equal(timeoutCallbacks[7].delay, 900, 're-arms the interaction idle timer when an expanded comment section is still open');
  timeoutCallbacks[7].handler();

  assert.deepEqual(cleanCalls, ['clean', 'clean', 'clean', 'clean'], 'does not resume cleanup just because the first idle timeout elapsed while comments are still open');
  assert.deepEqual(interactionRepairCalls, ['repair', 'repair', 'repair', 'repair'], 'tries duplicate-only repair again while the comment interaction remains active');

  expandedCommentsOpen = false;
  timeoutCallbacks[8].handler();

  assert.deepEqual(cleanCalls, ['clean', 'clean', 'clean', 'clean', 'clean'], 'runs the deferred cleanup only after the expanded comment section is closed');
}

console.log('Passed 54 assertions.');
