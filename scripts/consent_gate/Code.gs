/**
 * Backend for the docs.athelas.com consent gate (athelas_gate.js at the repo root).
 *
 * The widget cannot call an Apps Script web app: Commure's Workspace only allows web
 * apps that require a Commure sign-in. So the widget submits every event (agreement,
 * email confirmation, page visits) to a Google Form, which accepts anonymous
 * submissions. This script is bound to the Sheet the Form writes to. On each
 * submission it emails the confirmation link, checks confirmations, and keeps two
 * readable tabs:
 *   Consents  one row per agreement: pending -> verified, with a note on anything odd
 *   Visits    one row per page viewed, joined to the consent's email
 * The raw submissions stay in "Raw events".
 *
 * The browser cannot read Form responses, so the widget trusts a confirmation link
 * as soon as it is opened. A forged link gets someone past the gate, but this script
 * still checks the link's signature, and only a real link marks a row "verified".
 *
 * This file is .gs on purpose: Mintlify injects every .js file in the repo into the
 * docs site, and this code must never ship to browsers.
 *
 * ---- Deploy ------------------------------------------------------------------
 * Use a Commure Workspace account, not a personal one: the Sheet holds customer
 * names and emails, and it is Legal's consent record.
 * 1. Create a Google Sheet "docs.athelas.com consent log". Share it only with Legal
 *    and the docs owner.
 * 2. Extensions > Apps Script. Replace Code.gs with this file and save. (A script
 *    made from script.google.com instead is not attached to the Sheet: add a
 *    SHEET_ID script property in Project Settings.)
 * 3. Pick `setup` in the function menu, click Run, and approve the permissions. It
 *    creates the Form, links it to this Sheet, adds the tabs and the submit trigger,
 *    and writes the widget config (Form URL + field IDs) to the Config tab.
 * 4. Copy the Config tab's values into FORM_URL and FIELDS in athelas_gate.js.
 * Running setup again is safe: it reuses the Form and replaces the trigger.
 */

const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_PER_HOUR = 3;
const MIN_MAIL_QUOTA = 25;
const MAX_PATHS_PER_EVENT = 50;
// Confirmation links may only point back at these origins.
const ALLOWED_ORIGINS = [
  'https://docs.athelas.com',
  'http://localhost:3000',
  'http://localhost:3333',
];
// Form questions, in order. The widget submits these by entry ID.
const FIELDS = [
  'event', 'consent_id', 'token', 'name', 'email', 'company', 'terms_version',
  'page', 'paths', 'referrer', 'return_url', 'device_id', 'user_agent',
];
const CONSENT_HEADERS = [
  'consent_id', 'created_at', 'name', 'email', 'company', 'terms_version', 'status',
  'verified_at', 'note', 'page', 'user_agent', 'device_id',
];
const VISIT_HEADERS = [
  'ts', 'consent_id', 'email', 'consent_status', 'path', 'referrer', 'device_id', 'terms_version',
];
const COL = Object.fromEntries(CONSENT_HEADERS.map((h, i) => [h, i + 1]));

// The Sheet this script is attached to, or the one named by the SHEET_ID script
// property for a standalone script.
function spreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
}

function setup() {
  const ss = spreadsheet();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  let form = props.getProperty('FORM_ID') && FormApp.openById(props.getProperty('FORM_ID'));
  if (!form) {
    form = FormApp.create('docs.athelas.com consent gate events');
    props.setProperty('FORM_ID', form.getId());
  }
  form.setDescription('Written to by the docs.athelas.com consent gate. Not for manual use.');
  const titles = form.getItems().map((item) => item.getTitle());
  FIELDS.filter((f) => titles.indexOf(f) < 0).forEach((f) => form.addTextItem().setTitle(f));
  let destination = null;
  try {
    destination = form.getDestinationId();
  } catch (err) {}
  if (destination !== ss.getId()) form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  form.setRequireLogin(false);
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);
  if (form.setPublished) form.setPublished(true);
  form.setAcceptingResponses(true);

  SpreadsheetApp.flush();
  const raw = ss.getSheets().find((sh) => sh.getFormUrl());
  if (raw && raw.getName() !== 'Raw events') raw.setName('Raw events');
  getSheet('Consents', CONSENT_HEADERS);
  getSheet('Visits', VISIT_HEADERS);
  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'onGateEvent')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onGateEvent').forSpreadsheet(ss).onFormSubmit().create();

  // Entry IDs for the widget, read off a prefilled link.
  const items = form.getItems();
  let resp = form.createResponse();
  items.forEach((item, i) => {
    resp = resp.withItemResponse(item.asTextItem().createResponse('F' + i));
  });
  const prefilled = resp.toPrefilledUrl();
  const fields = {};
  items.forEach((item, i) => {
    const m = prefilled.match(new RegExp('entry\\.(\\d+)=F' + i + '(?:&|$)'));
    fields[item.getTitle()] = 'entry.' + m[1];
  });
  const config = {
    FORM_URL: form.getPublishedUrl().replace(/\/viewform.*$/, '/formResponse'),
    FIELDS: fields,
  };
  const cfg = ss.getSheetByName('Config') || ss.insertSheet('Config');
  cfg.clear();
  cfg.getRange(1, 1, 3, 2).setValues([
    ['FORM_URL', config.FORM_URL],
    ['FIELDS', JSON.stringify(config.FIELDS)],
    ['Form editor', form.getEditUrl()],
  ]);
  console.log(JSON.stringify(config, null, 2));
}

function onGateEvent(e) {
  const v = {};
  FIELDS.forEach((f) => {
    v[f] = clean(e.namedValues[f] && e.namedValues[f][0], f === 'paths' ? 20000 : 500);
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (v.event === 'request') handleRequest(v);
    else if (v.event === 'verify') handleVerify(v);
    else if (v.event === 'visit') handleVisit(v);
  } catch (err) {
    console.error(err);
  } finally {
    lock.releaseLock();
  }
}

function handleRequest(v) {
  const email = v.email.toLowerCase();
  const sheet = getSheet('Consents', CONSENT_HEADERS);
  const row = [
    v.consent_id, new Date(), v.name.slice(0, 120), email.slice(0, 200), v.company.slice(0, 160),
    v.terms_version, 'pending', '', '', v.page, v.user_agent, v.device_id,
  ];
  const note = (msg) => {
    row[COL.note - 1] = msg;
    sheet.appendRow(row);
  };

  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(v.consent_id) || findConsentRow(v.consent_id)) {
    return note('bad or duplicate consent_id');
  }
  if (v.name.length < 2 || v.company.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return note('invalid fields: no email sent');
  }
  const origin = (v.return_url.match(/^(https?:\/\/[^/?#]+)/) || [])[1];
  if (ALLOWED_ORIGINS.indexOf(origin) < 0) return note('return_url not allowed: no email sent');

  const cache = CacheService.getScriptCache();
  const rlKey = 'rl:' + email;
  const sent = Number(cache.get(rlKey) || 0);
  if (sent >= RATE_LIMIT_PER_HOUR) return note('rate limited: no email sent');
  if (MailApp.getRemainingDailyQuota() < MIN_MAIL_QUOTA) return note('mail quota low: no email sent');

  const link = v.return_url + (v.return_url.indexOf('?') < 0 ? '?' : '&') +
    'athelas_verify=' + v.consent_id + '.' + sign(v.consent_id);
  MailApp.sendEmail({
    to: email,
    subject: 'Confirm your email to view the Athelas documentation',
    name: 'Athelas Docs',
    noReply: true,
    htmlBody:
      '<p>Hi ' + escapeHtml(v.name) + ',</p>' +
      '<p>Confirm your email to continue to the Athelas documentation. ' +
      'Open this link in the same browser you used to agree. It works for 24 hours.</p>' +
      '<p><a href="' + escapeHtml(link) + '" style="display:inline-block;padding:10px 18px;background:#F9345F;' +
      'color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">Confirm and continue</a></p>' +
      '<p style="color:#6b7280;font-size:12px">If you did not request this, you can ignore this email.</p>',
  });
  cache.put(rlKey, String(sent + 1), 3600);
  sheet.appendRow(row);
}

function handleVerify(v) {
  const r = findConsentRow(v.consent_id);
  if (!r) return;
  const sheet = getSheet('Consents', CONSENT_HEADERS);
  const created = sheet.getRange(r, COL.created_at).getValue();
  const status = sheet.getRange(r, COL.status).getValue();
  if (status === 'verified') return;
  if (v.token !== sign(v.consent_id)) {
    sheet.getRange(r, COL.note).setValue('confirmation with a bad token at ' + new Date().toISOString());
    return;
  }
  if (Date.now() - new Date(created).getTime() > LINK_TTL_MS) {
    sheet.getRange(r, COL.note).setValue('confirmation after the link expired');
    return;
  }
  sheet.getRange(r, COL.status, 1, 2).setValues([['verified', new Date()]]);
}

function handleVisit(v) {
  const paths = v.paths.split('\n').map((p) => p.trim()).filter(Boolean).slice(0, MAX_PATHS_PER_EVENT);
  if (!paths.length) return;
  const r = findConsentRow(v.consent_id);
  const consents = getSheet('Consents', CONSENT_HEADERS);
  const email = r ? consents.getRange(r, COL.email).getValue() : '';
  const status = r ? consents.getRange(r, COL.status).getValue() : 'unknown consent';
  const now = new Date();
  const rows = paths.map((p, i) => [
    now, v.consent_id, email, status, p.slice(0, 300), i === 0 ? v.referrer : '', v.device_id, v.terms_version,
  ]);
  const sheet = getSheet('Visits', VISIT_HEADERS);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function findConsentRow(id) {
  if (!id) return null;
  const sheet = getSheet('Consents', CONSENT_HEADERS);
  const hit = sheet.getRange(1, COL.consent_id, Math.max(sheet.getLastRow(), 1), 1)
    .createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : null;
}

function sign(id) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  const bytes = Utilities.computeHmacSha256Signature(id, secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '').slice(0, 22);
}

function getSheet(name, headers) {
  const ss = spreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function clean(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
