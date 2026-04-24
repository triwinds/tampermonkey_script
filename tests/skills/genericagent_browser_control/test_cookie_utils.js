const assert = require('node:assert/strict');
const path = require('node:path');

const helpers = require(path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'skills',
  'genericagent-browser-control',
  'assets',
  'tmwd_cdp_bridge',
  'cookie_utils.js'
));

assert.equal(helpers.getTopLevelSite('https://example.com/path?q=1'), 'https://example.com');
assert.equal(helpers.getTopLevelSite('http://localhost:3000/test'), 'http://localhost:3000');

assert.equal(helpers.getTopLevelSite('chrome://extensions'), null);
assert.equal(helpers.getTopLevelSite('edge://extensions'), null);
assert.equal(helpers.getTopLevelSite('about:blank'), null);
assert.equal(helpers.getTopLevelSite('not-a-url'), null);
assert.equal(helpers.getTopLevelSite(''), null);

assert.equal(helpers.isSupportedCookieUrl('https://example.com'), true);
assert.equal(helpers.isSupportedCookieUrl('http://example.com'), true);
assert.equal(helpers.isSupportedCookieUrl('chrome://extensions'), false);

const message = helpers.cookieErrorMessage('chrome://extensions');
assert.match(message, /http\(s\)/i);
assert.match(message, /chrome:\/\/extensions/);

console.log('cookie_utils regression checks passed');
