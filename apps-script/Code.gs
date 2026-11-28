/**
 * TEDxAteneodeManilaU Core Workspace mail relay.
 *
 * Called only by the Supabase email-adapter function. Every POST is signed:
 *   POST <web app url>?ts=<unix seconds>&sig=<hex HMAC-SHA256(HMAC_SECRET, ts + '.' + rawBody)>
 *   body: {"v":1,"action":"send"|"health","type":...,"jobId":...,"to":...,"subject":...,"text":...,"html"?:...,"replyTo"?:...,"ts":...,"nonce":...}
 * type "developer_message" (from the developer-message function) needs replyTo and is limited to 5 per sender per hour.
 * Apps Script cannot read request headers, so the signature travels in the query string.
 * Every handled request answers HTTP 200 with JSON {outcome: ...}; the caller reads the outcome, never the status.
 *
 * Script Properties (Project Settings -> Script properties):
 *   HMAC_SECRET  required, the value printed once by scripts/setup-reminders.sh
 *   NO_REPLY     optional, 'true' or 'false'; defaults to true on Google Workspace accounts, false on @gmail.com
 *   NOTIFICATION_DISPATCH_SECRET, EMAIL_DISPATCH_SECRET
 *                optional, printed once by scripts/rotate-dispatch-secrets.sh; used by runReminders()
 *
 * Reminders: runReminders() calls the dispatch-notifications and email-adapter functions, like the GitHub
 * "Reminders" workflow, but from a time-driven trigger that actually fires every 15 minutes (GitHub's
 * scheduler was firing every 6-9 hours). Run installReminderTrigger() once from the editor to set it up.
 * Running both this trigger and the GitHub workflow is safe: jobs are claimed with leases.
 */

var SENDER_NAME = 'TEDxAteneodeManilaU Core Workspace';
var ALLOWED_RECIPIENT = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@student\.ateneo\.edu$/;
var JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var CLOCK_WINDOW_SECONDS = 300;
var DEDUPE_SECONDS = 21600; // 6 hours, the CacheService maximum
var MAX_BODY = 65536;
// Reply-To may be any ordinary address (guests are not always on the school domain); it is a header, not a recipient.
var REPLY_TO = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
var DEVELOPER_MESSAGES_PER_WINDOW = 5;
var DEVELOPER_WINDOW_SECONDS = 3600;

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
  var replyTo = typeof message.replyTo === 'string' ? message.replyTo : null;
  if (typeof message.jobId !== 'string' || !JOB_ID.test(message.jobId)) return { outcome: 'failed', error: 'invalid' };
  if (to.length > 254 || !ALLOWED_RECIPIENT.test(to)) return { outcome: 'failed', error: 'recipient' };
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || !text || text.length > 20000 ||
      (html !== null && html.length > 50000) || (replyTo !== null && (replyTo.length > 254 || !REPLY_TO.test(replyTo)))) {
    return { outcome: 'failed', error: 'invalid' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { outcome: 'retry', delay: 60 };
  try {
    var jobKey = 'job:' + message.jobId;
    if (cache.get(jobKey)) return { outcome: 'accepted', id: message.jobId, duplicate: true };
    // Messages to the developer are capped per sender so one person cannot flood the inbox or the quota.
    var limitKey = null, limit = null;
    if (message.type === 'developer_message') {
      if (replyTo === null) return { outcome: 'failed', error: 'invalid' };
      limitKey = 'devmsg:' + replyTo.toLowerCase();
      limit = JSON.parse(cache.get(limitKey) || 'null') || { n: 0, until: Date.now() + DEVELOPER_WINDOW_SECONDS * 1000 };
      if (limit.until <= Date.now()) limit = { n: 0, until: Date.now() + DEVELOPER_WINDOW_SECONDS * 1000 };
      if (limit.n >= DEVELOPER_MESSAGES_PER_WINDOW) {
        return { outcome: 'retry', delay: Math.max(60, Math.ceil((limit.until - Date.now()) / 1000)), error: 'limited' };
      }
    }
    if (MailApp.getRemainingDailyQuota() < 1) return { outcome: 'quota' };

    var options = { name: SENDER_NAME };
    if (noReply_()) options.noReply = true;
    if (html !== null) options.htmlBody = html;
    if (replyTo !== null) options.replyTo = replyTo;
    MailApp.sendEmail(to, subject, text, options);
    cache.put(jobKey, '1', DEDUPE_SECONDS);
    if (limitKey) {
      limit.n += 1;
      cache.put(limitKey, JSON.stringify(limit), Math.max(1, Math.ceil((limit.until - Date.now()) / 1000)));
    }
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

var FUNCTIONS_URL = 'https://wyurosneoxfqqrrvstke.supabase.co/functions/v1';
var REMINDER_STEPS = [
  { fn: 'dispatch-notifications', header: 'x-notification-dispatch-secret', property: 'NOTIFICATION_DISPATCH_SECRET' },
  { fn: 'email-adapter', header: 'x-email-dispatch-secret', property: 'EMAIL_DISPATCH_SECRET' }
];

/** One reminder run: queue and deliver in-app reminders, then send queued email. Called by the time trigger. */
function runReminders() {
  var props = PropertiesService.getScriptProperties();
  REMINDER_STEPS.forEach(function (step) {
    var secret = props.getProperty(step.property);
    if (!secret) { console.warn(step.property + ' is not set in Script properties; skipping ' + step.fn); return; }
    var headers = {};
    headers[step.header] = secret;
    try {
      var response = UrlFetchApp.fetch(FUNCTIONS_URL + '/' + step.fn, { method: 'post', headers: headers, muteHttpExceptions: true });
      console.log(step.fn + ' HTTP ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 300));
    } catch (error) {
      console.error(step.fn + ' failed: ' + error);
    }
  });
}

/** Run once from the editor (Run > installReminderTrigger). Replaces any earlier reminder trigger. */
function installReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runReminders') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runReminders').timeBased().everyMinutes(15).create();
  console.log('Reminder trigger installed: runReminders every 15 minutes.');
}
