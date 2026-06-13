// ==UserScript==
// @name         Weibo Feed Ad Cleaner
// @namespace    https://tampermonkey.net/
// @version      0.2.0
// @description  Remove ad cards from the Weibo PC feed by filtering feed API responses and cleaning Weibo's runtime fallback data.
// @author       Codex
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const START_FLAG = '__weiboFeedAdCleanerController__';
  const RESPONSE_HOOK_FLAG = '__weiboFeedAdCleanerResponseHooked__';
  const SCROLLER_RUNTIME_FLAG = '__weiboFeedAdCleanerScrollerRuntime__';
  const CLEAN_INTERVAL_MS = 1200;
  const MUTATION_DEBOUNCE_MS = 80;
  const INTERACTION_IDLE_MS = 260;
  const SCROLLER_REPAIR_DELAY_MS = 80;
  const SCROLLER_REPAIR_PASSES = 2;
  const FEED_CARD_SELECTOR = 'article.woo-panel-main';
  const FEED_MUTATION_SELECTOR = [
    FEED_CARD_SELECTOR,
    '.wbpro-scroller-item',
    '.vue-recycle-scroller__item-view',
  ].join(', ');
  const BLOCKED_BADGES = ['广告'];
  const FEED_API_RE = /\/ajax\/feed\//i;

  // Keep this false by default: removing local feed items is enough, and server-side
  // dislike feedback can alter the account's recommendation profile.
  const SEND_WEIBO_FEEDBACK = false;

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function summarizeText(value, maxLength = 80) {
    const text = normalizeText(value);
    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
  }

  function summarizeUrl(value, maxLength = 180) {
    if (!value) {
      return '';
    }

    try {
      const url = new URL(String(value), typeof location !== 'undefined' ? location.href : 'https://weibo.com/');
      return summarizeText(`${url.pathname}${url.search}`, maxLength);
    } catch (_) {
      return summarizeText(value, maxLength);
    }
  }

  function isLikelyHeaderMetaText(value) {
    const text = normalizeText(value);
    return /^(刚刚|今天|昨天|前天|[0-9]{1,2}:[0-9]{2}|[0-9]+(?:秒|分钟|小时|天|周|月|年)前|来自|已编辑|置顶|[0-9])/u.test(text);
  }

  function isBadgeBoundaryChar(value = '') {
    return !value || /[\s|｜/:：·•,【】()（）<>{}\[\]\-0-9]/u.test(value);
  }

  function findBlockedBadge(value, labels = BLOCKED_BADGES) {
    const text = normalizeText(value);
    if (!text) {
      return '';
    }

    for (const label of labels) {
      if (text === label) {
        return label;
      }

      if (text.startsWith(label) && isLikelyHeaderMetaText(text.slice(label.length))) {
        return label;
      }

      let index = text.indexOf(label);
      while (index !== -1) {
        const before = text[index - 1] || '';
        const after = text[index + label.length] || '';
        if (isBadgeBoundaryChar(before) && isBadgeBoundaryChar(after)) {
          return label;
        }
        index = text.indexOf(label, index + label.length);
      }
    }

    return '';
  }

  function collectTextContent(nodes) {
    return Array.from(nodes || [], (node) => normalizeText(node.textContent)).filter(Boolean);
  }

  function collectAttribute(nodes, attributeName) {
    return Array.from(nodes || [], (node) => normalizeText(node.getAttribute(attributeName))).filter(Boolean);
  }

  function collectCardSignals(card) {
    const header = card?.querySelector?.('header') || card;
    if (!header) {
      return {
        headerText: '',
        tagTexts: [],
        titleTexts: [],
        ariaLabels: [],
      };
    }

    return {
      headerText: normalizeText(header.textContent),
      tagTexts: collectTextContent(header.querySelectorAll?.('*')),
      titleTexts: collectAttribute(header.querySelectorAll?.('[title]'), 'title'),
      ariaLabels: collectAttribute(header.querySelectorAll?.('[aria-label]'), 'aria-label'),
    };
  }

  function hasBlockedBadge(values) {
    return values.some((value) => Boolean(findBlockedBadge(value)));
  }

  function shouldRemoveCardBySignals(signals = {}) {
    return Boolean(findBlockedBadge(signals.headerText))
      || hasBlockedBadge(signals.tagTexts || [])
      || hasBlockedBadge(signals.titleTexts || [])
      || hasBlockedBadge(signals.ariaLabels || []);
  }

  function shouldRemoveCard(card) {
    return shouldRemoveCardBySignals(collectCardSignals(card));
  }

  function getVueApp(doc = document) {
    return doc.querySelector?.('#app')?.__vue_app__
      || doc.body?.__vue_app__
      || null;
  }

  function getWeiboRuntime(doc = document, win = window) {
    const app = getVueApp(doc);
    const globalProperties = app?._context?.config?.globalProperties || null;
    const store = globalProperties?.$store || null;
    const http = globalProperties?.$http || null;

    if (!app || !store) {
      return null;
    }

    return {
      app,
      doc,
      http,
      locationHref: win?.location?.href || '',
      store,
      win,
    };
  }

  function collectFeedStatusLists(feedState = {}) {
    const latestList = feedState?.latestList;
    if (!latestList || typeof latestList !== 'object') {
      return [];
    }

    const seen = new Set();
    const lists = [];
    for (const bucket of Object.values(latestList)) {
      if (!Array.isArray(bucket?.statuses) || seen.has(bucket.statuses)) {
        continue;
      }
      seen.add(bucket.statuses);
      lists.push(bucket.statuses);
    }
    return lists;
  }

  function isBlockedStatus(status = {}) {
    if (!status || typeof status !== 'object') {
      return false;
    }

    const mark = normalizeText(status.mark);
    const promotionType = normalizeText(status.promotion?.type).toLowerCase();
    const readTimeType = normalizeText(status.readtimetype).toLowerCase();

    return status.isAd === 1
      || status.isAd === true
      || mark.includes('reallog_mark_ad')
      || promotionType === 'ad'
      || readTimeType === 'admblog';
  }

  function isWeiboHost(hostname = '') {
    return /(^|\.)weibo\.com$/i.test(hostname);
  }

  function isFeedApiUrl(value, baseHref = typeof location !== 'undefined' ? location.href : 'https://weibo.com/') {
    if (typeof value !== 'string' && !(value instanceof URL)) {
      return false;
    }

    try {
      const url = new URL(String(value), baseHref);
      return isWeiboHost(url.hostname) && FEED_API_RE.test(url.pathname);
    } catch (_) {
      return FEED_API_RE.test(String(value));
    }
  }

  function hasAdPayloadHint(text) {
    return typeof text === 'string'
      && /"isAd"\s*:\s*(?:1|true)|reallog_mark_ad|"readtimetype"\s*:\s*"adMblog"|"promotion"\s*:/i.test(text);
  }

  function sanitizeFeedJsonValue(value, options = {}, seen = new WeakSet()) {
    if (options instanceof WeakSet) {
      seen = options;
      options = {};
    }
    if (!options || typeof options !== 'object') {
      options = {};
    }

    if (!value || typeof value !== 'object') {
      return 0;
    }

    if (seen.has(value)) {
      return 0;
    }
    seen.add(value);

    let removedCount = 0;

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const item = value[index];
        if (isBlockedStatus(item)) {
          if (options.log !== false) {
            logRemoval(options.source || 'api', {
              apiUrl: summarizeUrl(options.url),
              index,
              ...summarizeStatus(item),
            });
          }
          value.splice(index, 1);
          removedCount += 1;
          continue;
        }
        removedCount += sanitizeFeedJsonValue(item, options, seen);
      }
      return removedCount;
    }

    for (const key of Object.keys(value)) {
      removedCount += sanitizeFeedJsonValue(value[key], options, seen);
    }
    return removedCount;
  }

  function sanitizeFeedResponseText(text, options = {}) {
    if (typeof text !== 'string' || !hasAdPayloadHint(text)) {
      return text;
    }

    try {
      const payload = JSON.parse(text);
      const removedCount = sanitizeFeedJsonValue(payload, options);
      return removedCount > 0 ? JSON.stringify(payload) : text;
    } catch (_) {
      return text;
    }
  }

  function findPropertyDescriptor(target, propertyName) {
    let current = target;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, propertyName);
      if (descriptor) {
        return descriptor;
      }
      current = Object.getPrototypeOf(current);
    }
    return null;
  }

  function installFetchHook(win = window) {
    if (!win || typeof win.fetch !== 'function') {
      return false;
    }

    const nativeFetch = win.fetch;
    win.fetch = function patchedFetch(input, init) {
      const requestedUrl = typeof input === 'string' || input instanceof URL
        ? String(input)
        : input?.url || '';

      return nativeFetch.call(this, input, init).then((response) => {
        if (!isFeedApiUrl(requestedUrl || response?.url || '', win.location?.href)) {
          return response;
        }

        return response.clone().text().then((text) => {
          const sanitized = sanitizeFeedResponseText(text, {
            source: 'api',
            url: requestedUrl || response?.url || '',
          });
          if (sanitized === text) {
            return response;
          }

          const headers = new Headers(response.headers);
          headers.delete('content-length');
          headers.delete('content-encoding');
          return new Response(sanitized, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        }).catch(() => response);
      });
    };

    return true;
  }

  function installXMLHttpRequestHook(win = window) {
    const XHR = win?.XMLHttpRequest;
    if (typeof XHR !== 'function' || !XHR.prototype) {
      return false;
    }

    const metadata = new WeakMap();
    const nativeOpen = XHR.prototype.open;
    const responseTextDescriptor = findPropertyDescriptor(XHR.prototype, 'responseText');
    const responseDescriptor = findPropertyDescriptor(XHR.prototype, 'response');

    XHR.prototype.open = function patchedOpen(method, url, ...rest) {
      metadata.set(this, {
        rawText: null,
        sanitizedText: null,
        url: String(url || ''),
      });
      return nativeOpen.call(this, method, url, ...rest);
    };

    function shouldSanitizeRequest(xhr) {
      const meta = metadata.get(xhr);
      return Boolean(meta)
        && xhr.readyState === 4
        && isFeedApiUrl(meta.url, win.location?.href);
    }

    function getSanitizedText(xhr) {
      const text = responseTextDescriptor?.get?.call(xhr);
      if (!shouldSanitizeRequest(xhr) || typeof text !== 'string') {
        return text;
      }

      const meta = metadata.get(xhr);
      if (meta.rawText === text) {
        return meta.sanitizedText;
      }

      const sanitized = sanitizeFeedResponseText(text, {
        source: 'api',
        url: meta.url,
      });
      meta.rawText = text;
      meta.sanitizedText = sanitized;
      return sanitized;
    }

    let patchedAnyDescriptor = false;
    if (responseTextDescriptor?.get) {
      try {
        Object.defineProperty(XHR.prototype, 'responseText', {
          configurable: true,
          enumerable: responseTextDescriptor.enumerable,
          get() {
            return getSanitizedText(this);
          },
        });
        patchedAnyDescriptor = true;
      } catch (_) {
        // Some engines expose XHR response accessors as non-configurable.
      }
    }

    if (responseDescriptor?.get) {
      try {
        Object.defineProperty(XHR.prototype, 'response', {
          configurable: true,
          enumerable: responseDescriptor.enumerable,
          get() {
            const responseType = this.responseType || '';
            if (!shouldSanitizeRequest(this)) {
              return responseDescriptor.get.call(this);
            }

            if (responseType === '' || responseType === 'text') {
              return getSanitizedText(this);
            }

            const responseValue = responseDescriptor.get.call(this);
            if (responseType === 'json' && responseValue && typeof responseValue === 'object') {
              sanitizeFeedJsonValue(responseValue, {
                source: 'api',
                url: metadata.get(this)?.url || '',
              });
            }
            return responseValue;
          },
        });
        patchedAnyDescriptor = true;
      } catch (_) {
        // Leave the runtime fallback in place when descriptor patching is blocked.
      }
    }

    return patchedAnyDescriptor;
  }

  function installResponseHooks(win = window) {
    if (!win || win[RESPONSE_HOOK_FLAG]) {
      return [];
    }

    try {
      Object.defineProperty(win, RESPONSE_HOOK_FLAG, {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false,
      });
    } catch (_) {
      win[RESPONSE_HOOK_FLAG] = true;
    }

    return [
      installXMLHttpRequestHook(win) && 'XMLHttpRequest',
      installFetchHook(win) && 'fetch',
    ].filter(Boolean);
  }

  function getStatusId(status = {}) {
    return String(status.idstr || status.id || status.mid || '');
  }

  function getStatusDedupKey(status = {}) {
    return getStatusId(status) || status;
  }

  function findHideStatusMenu(status = {}) {
    const menus = Array.isArray(status.mblog_menus_new) ? status.mblog_menus_new : [];
    return menus.find((menu) => menu?.type === 'mblog_menus_hide_status' && menu?.name === '不感兴趣')
      || menus.find((menu) => menu?.type === 'mblog_menus_hide_status' && menu?.name === '屏蔽此博主')
      || menus.find((menu) => menu?.type === 'mblog_menus_hide_status')
      || null;
  }

  function getMenuBackKey(menu = {}) {
    if (menu.name === '不感兴趣') {
      return '1';
    }
    if (menu.name === '屏蔽此博主') {
      return '2';
    }
    return normalizeText(menu.need_back);
  }

  function safePost(http, url, payload) {
    if (!http || typeof http.post !== 'function') {
      return false;
    }

    try {
      const request = http.post.call(http, url, payload);
      if (request && typeof request.catch === 'function') {
        request.catch(() => {});
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function reportStatusHidden(runtime, status, menu = findHideStatusMenu(status)) {
    if (!SEND_WEIBO_FEEDBACK || !runtime?.http) {
      return false;
    }

    const id = getStatusId(status);
    const actionlog = menu?.actionlog || status?.extra_button_info?.actionlog || null;
    if (actionlog) {
      safePost(runtime.http, '/ajax/feed/throwbatch', { actionlog });
    }

    const menuKey = getMenuBackKey(menu || {});
    if (menuKey && id) {
      safePost(runtime.http, '/ajax/feed/menuback', {
        menu_key: menuKey,
        mid: id,
      });
    }

    return true;
  }

  function logRemoval(source, details = {}) {
    if (typeof console === 'undefined' || typeof console.info !== 'function') {
      return;
    }

    console.info(`[weibo-feed-ad-cleaner][${source}] removed ad card`, {
      source,
      ...details,
    });
  }

  function summarizeStatus(status = {}) {
    return {
      id: getStatusId(status),
      isAd: status.isAd,
      mark: summarizeText(status.mark, 80),
      promotionType: normalizeText(status.promotion?.type),
      readtimetype: normalizeText(status.readtimetype),
    };
  }

  function cleanStatusArray(statuses, runtime = null, removedStatusIds = new Set(), source = 'runtime') {
    if (!Array.isArray(statuses)) {
      return 0;
    }

    let removedCount = 0;
    for (let index = statuses.length - 1; index >= 0; index -= 1) {
      const status = statuses[index];
      if (!isBlockedStatus(status)) {
        continue;
      }

      statuses.splice(index, 1);
      removedCount += 1;

      const dedupKey = getStatusDedupKey(status);
      if (!removedStatusIds.has(dedupKey)) {
        removedStatusIds.add(dedupKey);
        reportStatusHidden(runtime, status);
        logRemoval(source, {
          index,
          ...summarizeStatus(status),
        });
      }
    }

    return removedCount;
  }

  function cleanFeedWithRuntime(runtime, removedStatusIds = new Set()) {
    const feedState = runtime?.store?.state?.feed;
    const lists = collectFeedStatusLists(feedState);
    let removedCount = 0;

    for (const statuses of lists) {
      removedCount += cleanStatusArray(statuses, runtime, removedStatusIds, 'runtime');
    }

    return removedCount;
  }

  function enqueueVueComponentChildren(queue, vnode) {
    if (!vnode) {
      return;
    }

    if (Array.isArray(vnode)) {
      vnode.forEach((child) => enqueueVueComponentChildren(queue, child));
      return;
    }

    if (vnode.component) {
      queue.push(vnode.component);
    }

    if (Array.isArray(vnode.children)) {
      vnode.children.forEach((child) => enqueueVueComponentChildren(queue, child));
    }

    if (Array.isArray(vnode.dynamicChildren)) {
      vnode.dynamicChildren.forEach((child) => enqueueVueComponentChildren(queue, child));
    }

    if (vnode.suspense?.activeBranch) {
      enqueueVueComponentChildren(queue, vnode.suspense.activeBranch);
    }
  }

  function getVisibleScrollerMetrics(root = document) {
    const indexes = Array.from(root?.querySelectorAll?.('.wbpro-scroller-item') || [], (item) => {
      const index = Number.parseInt(item?.dataset?.index ?? '', 10);
      return Number.isInteger(index) ? index : null;
    }).filter((index) => index !== null);

    return {
      visibleCount: indexes.length,
      maxIndex: indexes.length ? Math.max(...indexes) : null,
    };
  }

  function pickBestDynamicScroller(scrollers, root = document) {
    const candidates = scrollers.filter((scroller) => Array.isArray(scroller?.items));
    if (candidates.length === 0) {
      return null;
    }

    const { visibleCount, maxIndex } = getVisibleScrollerMetrics(root);
    const minimumLength = Math.max(visibleCount, maxIndex === null ? 0 : maxIndex + 1);
    const valid = candidates.filter((scroller) => scroller.items.length >= minimumLength);
    const pool = valid.length ? valid : candidates;

    return pool.reduce((best, scroller) => {
      if (!best || scroller.items.length > best.items.length) {
        return scroller;
      }
      return best;
    }, null);
  }

  function getFeedScrollerRuntime(doc = document, win = window) {
    const cached = win?.[SCROLLER_RUNTIME_FLAG];
    const { visibleCount, maxIndex } = getVisibleScrollerMetrics(doc);
    if (
      Array.isArray(cached?.dynamicScroller?.items)
      && cached.dynamicScroller.items.length >= visibleCount
      && (maxIndex === null || cached.dynamicScroller.items.length > maxIndex)
    ) {
      return cached;
    }

    const app = getVueApp(doc);
    const rootComponent = app?._container?._vnode?.component;
    if (!rootComponent) {
      return null;
    }

    const seen = new Set();
    const queue = [rootComponent];
    const dynamicScrollerCandidates = [];
    const recycleScrollerCandidates = [];

    while (queue.length) {
      const component = queue.shift();
      if (!component || seen.has(component)) {
        continue;
      }

      seen.add(component);
      const componentName = component.type?.name || component.type?.__name || '';
      if (componentName === 'DynamicScroller') {
        dynamicScrollerCandidates.push(component.proxy || null);
      } else if (componentName === 'RecycleScroller') {
        recycleScrollerCandidates.push(component.proxy || null);
      }

      enqueueVueComponentChildren(queue, component.subTree);
    }

    const dynamicScroller = pickBestDynamicScroller(dynamicScrollerCandidates, doc);
    const recycleScroller = recycleScrollerCandidates.find((scroller) => typeof scroller?.handleScroll === 'function') || null;
    const runtime = dynamicScroller || recycleScroller ? { dynamicScroller, recycleScroller } : null;

    if (win) {
      win[SCROLLER_RUNTIME_FLAG] = runtime;
    }
    return runtime;
  }

  function getScrollerItemIndex(card) {
    if (!card?.closest?.('.vue-recycle-scroller__item-view')) {
      return null;
    }

    const item = card.closest('.wbpro-scroller-item');
    const index = Number.parseInt(item?.dataset?.index ?? '', 10);
    return Number.isInteger(index) ? index : null;
  }

  function collectBadgeMatchedScrollerIndexes(root = document) {
    return Array.from(root?.querySelectorAll?.(FEED_CARD_SELECTOR) || [])
      .filter((card) => shouldRemoveCard(card))
      .map((card) => getScrollerItemIndex(card))
      .filter((index) => Number.isInteger(index));
  }

  function collectScrollerItemProxies(scrollerRuntime) {
    const rootComponent = scrollerRuntime?.dynamicScroller?._ || scrollerRuntime?.recycleScroller?._;
    if (!rootComponent) {
      return [];
    }

    const seen = new Set();
    const queue = [rootComponent];
    const items = [];
    while (queue.length) {
      const component = queue.shift();
      if (!component || seen.has(component)) {
        continue;
      }

      seen.add(component);
      const componentName = component.type?.name || component.type?.__name || '';
      if (componentName === 'DynamicScrollerItem' && component.proxy) {
        items.push(component.proxy);
      }
      enqueueVueComponentChildren(queue, component.subTree);
    }
    return items;
  }

  function repairScrollerItemSizes(scrollerRuntime) {
    let repairedCount = 0;
    for (const item of collectScrollerItemProxies(scrollerRuntime)) {
      if (item?.finalActive === false || typeof item?.updateSize !== 'function') {
        continue;
      }
      item.updateSize();
      repairedCount += 1;
    }

    if (repairedCount > 0) {
      scrollerRuntime?.recycleScroller?.handleScroll?.();
    }
    return repairedCount;
  }

  function scheduleScrollerRepair(scrollerRuntime, win = window) {
    if (!scrollerRuntime || !win || typeof win.setTimeout !== 'function') {
      return 0;
    }

    let remaining = SCROLLER_REPAIR_PASSES;
    const runPass = () => {
      repairScrollerItemSizes(scrollerRuntime);
      remaining -= 1;
      if (remaining > 0) {
        win.setTimeout(runPass, SCROLLER_REPAIR_DELAY_MS);
      }
    };

    win.setTimeout(runPass, SCROLLER_REPAIR_DELAY_MS);
    return SCROLLER_REPAIR_PASSES;
  }

  function cleanFeedWithScrollerRuntime(scrollerRuntime, root = document, runtime = null, removedStatusIds = new Set(), win = window) {
    const items = scrollerRuntime?.dynamicScroller?.items;
    if (!Array.isArray(items)) {
      return 0;
    }

    const indexes = new Set();
    for (let index = 0; index < items.length; index += 1) {
      if (isBlockedStatus(items[index])) {
        indexes.add(index);
      }
    }

    for (const index of collectBadgeMatchedScrollerIndexes(root)) {
      indexes.add(index);
    }

    const sortedIndexes = Array.from(indexes)
      .filter((index) => index >= 0 && index < items.length)
      .sort((left, right) => right - left);

    if (sortedIndexes.length === 0) {
      return 0;
    }

    for (const index of sortedIndexes) {
      const status = items[index];
      items.splice(index, 1);

      const dedupKey = getStatusDedupKey(status);
      if (!removedStatusIds.has(dedupKey)) {
        removedStatusIds.add(dedupKey);
        reportStatusHidden(runtime, status);
        logRemoval('scroller', {
          index,
          ...summarizeStatus(status),
        });
      }
    }

    scrollerRuntime.dynamicScroller.forceUpdate?.(true);
    scrollerRuntime.recycleScroller?.handleScroll?.();
    scheduleScrollerRepair(scrollerRuntime, win);
    return sortedIndexes.length;
  }

  function findRemovalTarget(card) {
    if (card.closest?.('.vue-recycle-scroller__item-view')) {
      return null;
    }

    return card.closest?.('.wbpro-scroller-item') || card;
  }

  function cleanFeedByDom(root = document) {
    let removedCount = 0;
    for (const card of Array.from(root?.querySelectorAll?.(FEED_CARD_SELECTOR) || [])) {
      if (!shouldRemoveCard(card)) {
        continue;
      }

      const target = findRemovalTarget(card);
      if (!target?.isConnected) {
        continue;
      }

      logRemoval('dom', {
        preview: summarizeText(card.innerText || card.textContent || ''),
      });
      target.remove();
      removedCount += 1;
    }
    return removedCount;
  }

  function cleanFeed(root = document, win = window) {
    const runtime = getWeiboRuntime(root, win);
    const scrollerRuntime = getFeedScrollerRuntime(root, win);
    const removedStatusIds = new Set();

    const runtimeRemoved = cleanFeedWithRuntime(runtime, removedStatusIds);
    const scrollerRemoved = cleanFeedWithScrollerRuntime(scrollerRuntime, root, runtime, removedStatusIds, win);
    const domRemoved = cleanFeedByDom(root);
    return runtimeRemoved + scrollerRemoved + domRemoved;
  }

  function isFeedMutationNode(node) {
    if (!node) {
      return false;
    }

    if (node.nodeType === 3) {
      return isFeedMutationNode(node.parentElement || node.parentNode);
    }

    if (node.nodeType !== 1) {
      return false;
    }

    return Boolean(node.matches?.(FEED_MUTATION_SELECTOR) || node.closest?.(FEED_MUTATION_SELECTOR));
  }

  function hasRelevantFeedMutation(records = []) {
    return Array.from(records).some((record) => (
      isFeedMutationNode(record.target)
      || Array.from(record.addedNodes || []).some(isFeedMutationNode)
      || Array.from(record.removedNodes || []).some(isFeedMutationNode)
    ));
  }

  function startCleaner(doc = document, intervalMs = CLEAN_INTERVAL_MS, win = window, cleaner = cleanFeed) {
    if (!doc || !win || typeof win.setTimeout !== 'function') {
      return null;
    }

    let cleanTimer = null;
    let lastInteractionAt = 0;
    const ObserverCtor = win.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    const observerTarget = doc.querySelector?.('#app') || doc.body || doc.documentElement;

    const requestClean = () => {
      if (cleanTimer && typeof win.clearTimeout === 'function') {
        win.clearTimeout(cleanTimer);
      }

      cleanTimer = win.setTimeout(() => {
        cleanTimer = null;
        const now = typeof Date !== 'undefined' && typeof Date.now === 'function' ? Date.now() : 0;
        if (now - lastInteractionAt < INTERACTION_IDLE_MS) {
          requestClean();
          return;
        }
        cleaner(doc, win);
      }, MUTATION_DEBOUNCE_MS);
    };

    const markInteraction = () => {
      lastInteractionAt = typeof Date !== 'undefined' && typeof Date.now === 'function' ? Date.now() : 0;
    };

    if (typeof win.addEventListener === 'function') {
      win.addEventListener('wheel', markInteraction, { passive: true, capture: true });
      win.addEventListener('scroll', markInteraction, { passive: true, capture: true });
      win.addEventListener('pointerdown', markInteraction, { passive: true, capture: true });
      win.addEventListener('touchstart', markInteraction, { passive: true, capture: true });
    }

    const controller = {
      intervalId: null,
      observer: null,
    };

    if (ObserverCtor && observerTarget) {
      controller.observer = new ObserverCtor((records) => {
        if (hasRelevantFeedMutation(records)) {
          requestClean();
        }
      });

      controller.observer.observe(observerTarget, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['title', 'aria-label', 'data-index'],
      });
    }

    cleaner(doc, win);
    if (typeof win.setInterval === 'function' && intervalMs > 0) {
      controller.intervalId = win.setInterval(() => cleaner(doc, win), intervalMs);
    }

    return controller;
  }

  const api = {
    BLOCKED_BADGES,
    CLEAN_INTERVAL_MS,
    MUTATION_DEBOUNCE_MS,
    normalizeText,
    findBlockedBadge,
    shouldRemoveCardBySignals,
    collectCardSignals,
    shouldRemoveCard,
    getWeiboRuntime,
    collectFeedStatusLists,
    isBlockedStatus,
    isFeedApiUrl,
    hasAdPayloadHint,
    sanitizeFeedJsonValue,
    sanitizeFeedResponseText,
    installFetchHook,
    installXMLHttpRequestHook,
    installResponseHooks,
    getStatusId,
    findHideStatusMenu,
    getMenuBackKey,
    cleanStatusArray,
    cleanFeedWithRuntime,
    getVisibleScrollerMetrics,
    pickBestDynamicScroller,
    getFeedScrollerRuntime,
    getScrollerItemIndex,
    collectBadgeMatchedScrollerIndexes,
    repairScrollerItemSizes,
    cleanFeedWithScrollerRuntime,
    findRemovalTarget,
    cleanFeedByDom,
    cleanFeed,
    hasRelevantFeedMutation,
    startCleaner,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    installResponseHooks(window);
    if (!window[START_FLAG]) {
      window[START_FLAG] = startCleaner(document, CLEAN_INTERVAL_MS, window);
    }
  }
})();
