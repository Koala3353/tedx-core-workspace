/**
 * TEDxAteneodeManilaU Core Workspace mail relay.
 *
 * Called only by the Supabase email-adapter function. Every POST is signed:
 *   POST <web app url>?ts=<unix seconds>&sig=<hex HMAC-SHA256(HMAC_SECRET, ts + '.' + rawBody)>
 *   body: {"v":1,"action":"send"|"health","type":...,"jobId":...,"to":...,"subject":...,"text":...,"html"?:...,"ts":...,"nonce":...}
 * Apps Script cannot read request headers, so the signature travels in the query string.
 * Every handled request answers HTTP 200 with JSON {outcome: ...}; the caller reads the outcome, never the status.
 *
 * Script Properties (Project Settings -> Script properties):
 *   HMAC_SECRET  required, the value printed once by scripts/setup-reminders.sh
 *   NO_REPLY     optional, 'true' or 'false'; defaults to true on Google Workspace accounts, false on @gmail.com
 */

var SENDER_NAME = 'TEDxAteneodeManilaU Core Workspace';
var ALLOWED_RECIPIENT = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@student\.ateneo\.edu$/;
var JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var CLOCK_WINDOW_SECONDS = 300;
var DEDUPE_SECONDS = 21600; // 6 hours, the CacheService maximum
var MAX_BODY = 65536;

function doGet() {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var result;
  try {
    result = handle_(e);
  } catch (err) {
    result = { outcome: 'failed', error: 'internal' };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('HMAC_SECRET');
  if (!secret || secret.length < 32) return { outcome: 'failed', error: 'unconfigured' };

  var params = (e && e.parameter) || {};
  var body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  var ts = String(params.ts || '');
  var sig = String(params.sig || '').toLowerCase();
  if (!/^\d{10}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig) || !body || body.length > MAX_BODY) {
    return { outcome: 'failed', error: 'denied' };
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > CLOCK_WINDOW_SECONDS) {
    return { outcome: 'failed', error: 'denied' };
  }
  var expected = hex_(Utilities.computeHmacSha256Signature(ts + '.' + body, secret, Utilities.Charset.UTF_8));
  if (!sameText_(expected, sig)) return { outcome: 'failed', error: 'denied' };

  var message;
  try {
    message = JSON.parse(body);
  } catch (err) {
    return { outcome: 'failed', error: 'invalid' };
  }
  if (!message || message.v !== 1 || String(message.ts) !== ts || typeof message.nonce !== 'string' ||
      message.nonce.length < 16 || message.nonce.length > 64) {
    return { outcome: 'failed', error: 'invalid' };
  }

  var cache = CacheService.getScriptCache();
  var nonceKey = 'nonce:' + message.nonce;
  if (cache.get(nonceKey)) return { outcome: 'failed', error: 'replay' };
  cache.put(nonceKey, '1', CLOCK_WINDOW_SECONDS * 2);

  if (message.action === 'health') {
    return { outcome: 'ok', remaining: MailApp.getRemainingDailyQuota() };
  }
  if (message.action !== 'send') return { outcome: 'failed', error: 'invalid' };
  return send_(message, cache);
}

function send_(message, cache) {
  var to = typeof message.to === 'string' ? message.to : '';
  var subject = typeof message.subject === 'string' ? message.subject : '';
  var text = typeof message.text === 'string' ? message.text : '';
  var html = typeof message.html === 'string' ? message.html : null;
  if (typeof message.jobId !== 'string' || !JOB_ID.test(message.jobId)) return { outcome: 'failed', error: 'invalid' };
  if (to.length > 254 || !ALLOWED_RECIPIENT.test(to)) return { outcome: 'failed', error: 'recipient' };
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || !text || text.length > 20000 ||
      (html !== null && html.length > 50000)) {
    return { outcome: 'failed', error: 'invalid' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { outcome: 'retry', delay: 60 };
  try {
    var jobKey = 'job:' + message.jobId;
    if (cache.get(jobKey)) return { outcome: 'accepted', id: message.jobId, duplicate: true };
    if (MailApp.getRemainingDailyQuota() < 1) return { outcome: 'quota' };

    var options = { name: SENDER_NAME };
    if (noReply_()) options.noReply = true;
    if (html !== null) options.htmlBody = html;
    MailApp.sendEmail(to, subject, text, options);
    cache.put(jobKey, '1', DEDUPE_SECONDS);
    return { outcome: 'accepted', id: message.jobId, remaining: MailApp.getRemainingDailyQuota() };
  } catch (err) {
    var reason = String((err && err.message) || err);
    if (/too many times|quota|limit exceeded/i.test(reason)) return { outcome: 'quota' };
    if (/invalid email|recipient/i.test(reason)) return { outcome: 'failed', error: 'recipient' };
    return { outcome: 'retry', delay: 300 };
  } finally {
    lock.releaseLock();
  }
}

function noReply_() {
  var configured = PropertiesService.getScriptProperties().getProperty('NO_REPLY');
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  var owner = Session.getEffectiveUser().getEmail() || '';
  return owner !== '' && !/@(gmail|googlemail)\.com$/i.test(owner);
}

function hex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out += (value < 16 ? '0' : '') + value.toString(16);
  }
  return out;
}

function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var difference = 0;
  for (var i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
