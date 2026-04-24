(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.TMWDCookieUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function getTopLevelSite(url) {
    if (typeof url !== 'string' || !url.trim()) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.origin;
    } catch (_) {
      return null;
    }
  }

  function isSupportedCookieUrl(url) {
    return getTopLevelSite(url) !== null;
  }

  function cookieErrorMessage(url) {
    const target = typeof url === 'string' && url ? url : 'the current tab';
    return `Cookie access is only available on http(s) tabs. Current tab: ${target}`;
  }

  return {
    getTopLevelSite,
    isSupportedCookieUrl,
    cookieErrorMessage,
  };
});
