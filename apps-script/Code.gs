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

/**
 * Owner reports. sendDailyReport() emails a daily summary (usage, work, bugs, system health) and
 * checkUrgent() emails only when something needs attention. Both ask the Supabase ops-report function
 * for the content, signed the same way the relay checks its callers: POST ?ts=&sig=hex(HMAC_SHA256(
 * HMAC_SECRET, ts + '.' + body)) with a one-time nonce. The recipient is fixed here and is not the
 * student-only ALLOWED_RECIPIENT used for relay sends.
 * Run installReportTriggers() once from the editor (daily at 7-8 AM Manila, urgent check every 15 minutes).
 */
var REPORT_TO = 'brigadokeene@gmail.com';
var REPORT_URL = FUNCTIONS_URL + '/ops-report';
var URGENT_REPEAT_MS = 6 * 3600 * 1000; // an alert that stays open is emailed again after 6 hours
var URGENT_STATE_PROPERTY = 'REPORT_URGENT_STATE';
var REPORT_FAILURES_PROPERTY = 'REPORT_FAILURES';
var REPORT_HANDLERS = ['sendDailyReport', 'checkUrgent'];

/** Daily summary email. Called by the daily time trigger; safe to run by hand. */
function sendDailyReport() {
  var result = requestReport_('daily');
  if (!result.ok) {
    sendReportMail_('TEDx Core daily report: could not be generated',
      'The ops-report function did not answer (' + result.error + ').\n\nCheck the function logs: ' +
      'https://supabase.com/dashboard/project/wyurosneoxfqqrrvstke/functions\n', null);
    return;
  }
  var email = result.reply.email;
  sendReportMail_(email.subject, email.text, email.html);
}

/** Urgent check. Called every 15 minutes; emails only for new alerts or ones still open after 6 hours. */
function checkUrgent() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var state = JSON.parse(props.getProperty(URGENT_STATE_PROPERTY) || '{}') || {};
    var now = Date.now();
    var result = requestReport_('urgent');
    var alerts, email;
    if (result.ok) {
      props.setProperty(REPORT_FAILURES_PROPERTY, '0');
      alerts = result.reply.alerts;
      email = result.reply.email;
    } else {
      // One failed call can be a cold start or a blip; two in a row (30 minutes) is worth an email.
      var failures = Number(props.getProperty(REPORT_FAILURES_PROPERTY) || '0') + 1;
      props.setProperty(REPORT_FAILURES_PROPERTY, String(failures));
      if (failures < 2) return;
      alerts = [{ key: 'report_unreachable', severity: 'critical', title: 'The ops-report function is not answering' }];
      email = {
        subject: 'URGENT: TEDx Core: the ops-report function is not answering',
        text: 'checkUrgent could not get a report ' + failures + ' times in a row (' + result.error + ').\n' +
          'Urgent checks are blind until this is fixed. Check the function logs and that ops-report is deployed:\n' +
          'https://supabase.com/dashboard/project/wyurosneoxfqqrrvstke/functions\n\n' +
          'MailApp quota left today: ' + MailApp.getRemainingDailyQuota() + '\n',
        html: null
      };
    }

    var next = {};
    var due = false;
    alerts.forEach(function (alert) {
      var id = alert.key + ':' + alert.severity;
      var last = typeof state[id] === 'number' ? state[id] : 0;
      if (!last || now - last >= URGENT_REPEAT_MS) due = true;
      next[id] = last;
    });
    if (due && email) {
      sendReportMail_(email.subject, email.text, email.html);
      Object.keys(next).forEach(function (id) { next[id] = now; });
    } else if (!alerts.length && Object.keys(state).length) {
      sendReportMail_('TEDx Core: all clear', 'The problems in the last urgent alert are resolved. Nothing needs attention now.\n' +
        'https://koala3353.github.io/tedx-core-workspace/\n', null);
    }
    props.setProperty(URGENT_STATE_PROPERTY, JSON.stringify(next));
  } finally {
    lock.releaseLock();
  }
}

/** Run once from the editor. Replaces earlier report triggers; leaves the runReminders trigger alone. */
function installReportTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (REPORT_HANDLERS.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('sendDailyReport').timeBased().everyDays(1).atHour(7).nearMinute(0).inTimezone('Asia/Manila').create();
  ScriptApp.newTrigger('checkUrgent').timeBased().everyMinutes(15).create();
  console.log('Report triggers installed: sendDailyReport daily at 7-8 AM Manila, checkUrgent every 15 minutes, to ' + REPORT_TO + '.');
}

function requestReport_(kind) {
  var secret = PropertiesService.getScriptProperties().getProperty('HMAC_SECRET');
  if (!secret || secret.length < 32) return { ok: false, error: 'HMAC_SECRET not set' };
  var ts = String(Math.floor(Date.now() / 1000));
  var body = JSON.stringify({ v: 1, kind: kind, ts: ts, nonce: Utilities.getUuid(), mailQuota: MailApp.getRemainingDailyQuota() });
  var sig = hex_(Utilities.computeHmacSha256Signature(ts + '.' + body, secret, Utilities.Charset.UTF_8));
  var response;
  try {
    response = UrlFetchApp.fetch(REPORT_URL + '?ts=' + ts + '&sig=' + sig,
      { method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true });
  } catch (err) {
    return { ok: false, error: 'network: ' + String((err && err.message) || err).slice(0, 120) };
  }
  var code = response.getResponseCode();
  if (code !== 200) return { ok: false, error: 'HTTP ' + code + ' ' + response.getContentText().slice(0, 120) };
  var reply;
  try { reply = JSON.parse(response.getContentText()); } catch (err) { return { ok: false, error: 'invalid JSON' }; }
  if (!reply || reply.ok !== true || reply.kind !== kind || !Array.isArray(reply.alerts)) return { ok: false, error: 'invalid reply' };
  var email = reply.email;
  if (email !== null && (!email || typeof email.subject !== 'string' || !email.subject || email.subject.length > 200 ||
      /[\r\n]/.test(email.subject) || typeof email.text !== 'string' || email.text.length > 100000 ||
      typeof email.html !== 'string' || email.html.length > 100000)) {
    return { ok: false, error: 'invalid email' };
  }
  if (kind === 'daily' && email === null) return { ok: false, error: 'empty report' };
  return { ok: true, reply: reply };
}

function sendReportMail_(subject, text, html) {
  if (MailApp.getRemainingDailyQuota() < 1) { console.warn('MailApp quota exhausted; report not sent: ' + subject); return; }
  var options = { name: SENDER_NAME };
  if (html) options.htmlBody = html;
  MailApp.sendEmail(REPORT_TO, subject, text, options);
}
