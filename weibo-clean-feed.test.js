const assert = require('node:assert/strict');

console.info = () => {};

const {
  shouldRemoveCardBySignals,
  findBlockedBadge,
  isBlockedStatus,
  findHideStatusMenu,
  getMenuBackKey,
  collectFeedStatusLists,
  isFeedApiUrl,
  sanitizeFeedJsonValue,
  sanitizeFeedResponseText,
  installResponseHooks,
  cleanFeedWithRuntime,
  cleanFeedWithScrollerRuntime,
  findRemovalTarget,
  cleanFeedByDom,
  getFeedScrollerRuntime,
  startCleaner,
} = require('./weibo-clean-feed.user.js');

assert.equal(isFeedApiUrl('/ajax/feed/friendstimeline', 'https://weibo.com/'), true);
assert.equal(isFeedApiUrl('https://weibo.com/ajax/feed/allGroups', 'https://weibo.com/'), true);
assert.equal(isFeedApiUrl('https://example.com/ajax/feed/friendstimeline', 'https://weibo.com/'), false);
assert.equal(isFeedApiUrl('https://weibo.com/ajax/log/read', 'https://weibo.com/'), false);

{
  const infoCalls = [];
  console.info = (...args) => infoCalls.push(args);
  const payload = {
    ok: 1,
    data: {
      statuses: [
        { idstr: '1', text_raw: 'normal' },
        { idstr: '2', isAd: 1, promotion: { type: 'ad' } },
        { idstr: '3', mark: '3_reallog_mark_ad:8|abc' },
      ],
    },
  };

  assert.equal(
    sanitizeFeedJsonValue(payload, { source: 'api', url: '/ajax/feed/friendstimeline?count=25' }),
    2,
    'removes ad statuses from feed JSON values',
  );
  assert.deepEqual(payload.data.statuses.map((status) => status.idstr), ['1']);
  assert.equal(infoCalls.length, 2, 'logs each API-filtered ad status');
  assert.equal(infoCalls[0][0], '[weibo-feed-ad-cleaner][api] removed ad card');
  assert.equal(infoCalls[0][1].source, 'api');
  assert.equal(infoCalls[0][1].apiUrl, '/ajax/feed/friendstimeline?count=25');
  console.info = () => {};
}

{
  const text = JSON.stringify({
    ok: 1,
    data: {
      statuses: [
        { idstr: '1', text_raw: 'normal' },
        { idstr: '2', readtimetype: 'adMblog' },
      ],
    },
  });
  const sanitized = sanitizeFeedResponseText(text);
  assert.notEqual(sanitized, text, 'rewrites feed response text when it contains ad statuses');
  assert.deepEqual(JSON.parse(sanitized).data.statuses.map((status) => status.idstr), ['1']);
}

{
  class FakeXMLHttpRequest {
    constructor() {
      this.readyState = 0;
      this.responseType = '';
      this._responseText = '';
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    get responseText() {
      return this._responseText;
    }

    get response() {
      if (this.responseType === 'json') {
        return JSON.parse(this._responseText);
      }
      return this._responseText;
    }
  }

  const win = {
    XMLHttpRequest: FakeXMLHttpRequest,
    location: { href: 'https://weibo.com/' },
  };
  const patched = installResponseHooks(win);
  assert.deepEqual(patched, ['XMLHttpRequest'], 'patches XHR when fetch is not present');

  const xhr = new win.XMLHttpRequest();
  xhr.open('GET', '/ajax/feed/friendstimeline?count=25');
  xhr.readyState = 4;
  xhr._responseText = JSON.stringify({
    data: {
      statuses: [
        { idstr: '1', text_raw: 'normal' },
        { idstr: '2', isAd: 1 },
      ],
    },
  });

  assert.deepEqual(JSON.parse(xhr.responseText).data.statuses.map((status) => status.idstr), ['1']);

  const jsonXhr = new win.XMLHttpRequest();
  jsonXhr.open('GET', '/ajax/feed/friendstimeline?count=25');
  jsonXhr.readyState = 4;
  jsonXhr.responseType = 'json';
  jsonXhr._responseText = JSON.stringify({
    data: {
      statuses: [
        { idstr: '1', text_raw: 'normal' },
        { idstr: '2', promotion: { type: 'ad' } },
      ],
    },
  });

  assert.deepEqual(jsonXhr.response.data.statuses.map((status) => status.idstr), ['1']);
}

assert.equal(findBlockedBadge('广告 1分钟前 来自 微博网页版'), '广告');
assert.equal(findBlockedBadge('广告1分钟前来自 微博网页版'), '广告');
assert.equal(findBlockedBadge('这条正文聊到广告法'), '');
assert.equal(findBlockedBadge('推广电影君 2分钟前'), '');

assert.equal(
  shouldRemoveCardBySignals({
    headerText: '广告 1分钟前 来自 微博网页版',
    tagTexts: [],
    titleTexts: [],
    ariaLabels: [],
  }),
  true,
  'removes cards with an ad badge in the feed header',
);

assert.equal(
  shouldRemoveCardBySignals({
    headerText: '广告法研究所 1分钟前 来自 微博网页版',
    tagTexts: [],
    titleTexts: [],
    ariaLabels: [],
  }),
  false,
  'does not treat account names containing the ad word as ad cards',
);

assert.equal(isBlockedStatus({ isAd: 1 }), true, 'uses Weibo isAd flag');
assert.equal(isBlockedStatus({ mark: '3_reallog_mark_ad:8|abc' }), true, 'uses Weibo ad mark');
assert.equal(isBlockedStatus({ promotion: { type: 'ad' } }), true, 'uses promotion ad type');
assert.equal(isBlockedStatus({ readtimetype: 'adMblog' }), true, 'uses ad read-time type');
assert.equal(isBlockedStatus({ isAd: 0, readtimetype: 'normal' }), false, 'keeps normal statuses');

const hideMenu = findHideStatusMenu({
  mblog_menus_new: [
    { type: 'mblog_menus_report', name: '投诉' },
    { type: 'mblog_menus_hide_status', name: '不感兴趣' },
  ],
});
assert.deepEqual(hideMenu, { type: 'mblog_menus_hide_status', name: '不感兴趣' });
assert.equal(getMenuBackKey({ name: '不感兴趣' }), '1');
assert.equal(getMenuBackKey({ name: '屏蔽此博主' }), '2');

{
  const shared = [{ idstr: '1' }];
  const feedState = {
    latestList: {
      a: { statuses: shared },
      b: { statuses: shared },
      c: { statuses: [{ idstr: '2' }] },
    },
  };
  assert.equal(collectFeedStatusLists(feedState).length, 2, 'deduplicates shared status arrays');
}

{
  const currentStatuses = [
    { idstr: '1', text_raw: 'normal' },
    { idstr: '2', isAd: 1, promotion: { type: 'ad' }, readtimetype: 'adMblog' },
    { idstr: '3', text_raw: 'normal 2' },
  ];
  const secondaryStatuses = [
    { idstr: '9', mark: '3_reallog_mark_ad:8|abc' },
  ];
  const runtime = {
    store: {
      state: {
        feed: {
          latestList: {
            current: { statuses: currentStatuses },
            secondary: { statuses: secondaryStatuses },
          },
        },
      },
    },
  };

  assert.equal(cleanFeedWithRuntime(runtime), 2, 'removes ads from all cached feed buckets');
  assert.deepEqual(currentStatuses.map((status) => status.idstr), ['1', '3']);
  assert.deepEqual(secondaryStatuses, []);
}

function createCard({ index = null, headerText = '', inVirtualScroller = true, connected = true } = {}) {
  const header = {
    textContent: headerText,
    querySelectorAll() {
      return [];
    },
  };

  const card = {
    isConnected: connected,
    textContent: headerText,
    querySelector(selector) {
      return selector === 'header' ? header : null;
    },
    closest(selector) {
      if (selector === '.vue-recycle-scroller__item-view') {
        return inVirtualScroller ? {} : null;
      }
      if (selector === '.wbpro-scroller-item') {
        return index === null ? null : { dataset: { index: String(index) } };
      }
      return null;
    },
    remove() {
      this.isConnected = false;
    },
  };
  return card;
}

{
  const infoCalls = [];
  console.info = (...args) => infoCalls.push(args);
  const card = createCard({
    headerText: '广告 1分钟前',
    inVirtualScroller: false,
  });
  const removedCount = cleanFeedByDom({
    querySelectorAll(selector) {
      return selector === 'article.woo-panel-main' ? [card] : [];
    },
  });

  assert.equal(removedCount, 1, 'removes DOM fallback ad cards');
  assert.equal(card.isConnected, false, 'DOM fallback removes the matching card');
  assert.equal(infoCalls.length, 1, 'logs DOM fallback removals');
  assert.equal(infoCalls[0][0], '[weibo-feed-ad-cleaner][dom] removed ad card');
  assert.equal(infoCalls[0][1].source, 'dom');
  console.info = () => {};
}

{
  const forceUpdateCalls = [];
  const handleScrollCalls = [];
  const timeoutCallbacks = [];
  const items = [
    { idstr: '1', text_raw: 'normal' },
    { idstr: '2', text_raw: 'badge-only ad candidate' },
    { idstr: '3', mark: '3_reallog_mark_ad:8|abc' },
    { idstr: '4', text_raw: 'normal 2' },
  ];
  const root = {
    querySelectorAll(selector) {
      if (selector === 'article.woo-panel-main') {
        return [createCard({ index: 1, headerText: '广告 1分钟前' })];
      }
      return [];
    },
  };
  const win = {
    setTimeout(fn) {
      timeoutCallbacks.push(fn);
      return timeoutCallbacks.length;
    },
  };

  const removedCount = cleanFeedWithScrollerRuntime(
    {
      dynamicScroller: {
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
    root,
    null,
    new Set(),
    win,
  );

  assert.equal(removedCount, 2, 'removes both runtime-marked and badge-matched scroller items');
  assert.deepEqual(items.map((item) => item.idstr), ['1', '4']);
  assert.deepEqual(forceUpdateCalls, [true]);
  assert.deepEqual(handleScrollCalls, ['scroll']);
  assert.equal(timeoutCallbacks.length, 1, 'schedules virtual-scroller size repair');
}

assert.equal(findRemovalTarget(createCard({ inVirtualScroller: true })), null);
assert.equal(
  findRemovalTarget(createCard({ inVirtualScroller: false, index: 2 })).dataset.index,
  '2',
  'allows direct DOM fallback only outside virtual scroller views',
);

function createComponent({ name = '', proxy = null, children = [] } = {}) {
  return {
    type: name ? { name } : {},
    proxy,
    subTree: {
      children: children.map((child) => ({ component: child })),
    },
  };
}

{
  const staleDynamicScroller = { items: [{ idstr: '1' }] };
  const correctDynamicScroller = { items: Array.from({ length: 8 }, (_, index) => ({ idstr: String(index + 1) })) };
  const recycleScroller = { handleScroll() {} };
  const rootComponent = createComponent({
    children: [
      createComponent({ name: 'DynamicScroller', proxy: staleDynamicScroller }),
      createComponent({ name: 'DynamicScroller', proxy: correctDynamicScroller }),
      createComponent({ name: 'RecycleScroller', proxy: recycleScroller }),
    ],
  });
  const doc = {
    body: null,
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
        return [{ dataset: { index: '3' } }, { dataset: { index: '7' } }];
      }
      return [];
    },
  };
  const win = {
    __weiboFeedAdCleanerScrollerRuntime__: {
      dynamicScroller: staleDynamicScroller,
      recycleScroller: null,
    },
  };

  const runtime = getFeedScrollerRuntime(doc, win);
  assert.equal(runtime.dynamicScroller, correctDynamicScroller);
  assert.equal(runtime.recycleScroller, recycleScroller);
}

{
  const listeners = new Map();
  const cleanCalls = [];
  const observerCallbacks = [];
  const timeoutCallbacks = [];
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
    body: { nodeType: 1 },
    documentElement: { nodeType: 1 },
    querySelector() {
      return null;
    },
  };
  const win = {
    MutationObserver: class {
      constructor(callback) {
        observerCallbacks.push(callback);
      }

      observe() {}
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    setInterval() {
      return 1;
    },
    setTimeout(handler, delay) {
      timeoutCallbacks.push({ handler, delay });
      return timeoutCallbacks.length;
    },
    clearTimeout() {},
  };

  const controller = startCleaner(doc, 1000, win, () => {
    cleanCalls.push('clean');
  });

  assert.equal(Boolean(controller.observer), true);
  assert.equal(controller.intervalId, 1);
  assert.deepEqual(cleanCalls, ['clean']);
  assert.equal(typeof listeners.get('scroll'), 'function');

  observerCallbacks[0]([
    {
      target: feedMutationTarget,
      addedNodes: [feedMutationTarget],
      removedNodes: [],
    },
  ]);

  assert.equal(timeoutCallbacks[0].delay, 80);
  timeoutCallbacks[0].handler();
  assert.deepEqual(cleanCalls, ['clean', 'clean']);
}

console.log('Passed assertions.');
