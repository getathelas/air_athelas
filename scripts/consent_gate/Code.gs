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
 * Every Consents row records the terms_version the person agreed to, and agreeing
 * again (for example after the Terms change) adds a new row, so a person's rows are
 * their acceptance history. The "Terms versions" tab holds the popup text and the
 * full Terms behind each terms_version, with the dates it was live. Visitors never
 * need an old version, so it lives only here, not on the docs site. When the Terms
 * change, fill in the old row's in_effect_until and add a row for the new version.
 * The tab holds no personal data, so retention never touches it.
 *
 * Athelas and Commure staff go through the same gate, but once their email is
 * verified their consent and its visits move to "Internal consents" and "Internal
 * visits", so the main tabs only show customers. The move waits for verification on
 * purpose: anyone can type an @commure.com address, and an unverified one stays in
 * Consents with a note so it gets noticed.
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
 * 5. Run `installRetentionTrigger` once to schedule the daily 6-year retention
 *    cleanup (see Retention below). `previewRetention` shows what it would delete.
 * 6. Once, after adding the internal tabs to an existing Sheet: run
 *    `previewInternalMove` to see which verified internal rows already in Consents
 *    and Visits would move, then `moveInternalRows` to move them.
 * 7. Fill in the "Terms versions" tab (setup creates it) for every terms_version
 *    the widget has used.
 */

const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_PER_HOUR = 3;
const MIN_MAIL_QUOTA = 25;
const MAX_PATHS_PER_EVENT = 50;
// Confirmation links may only point back at these origins.
const ALLOWED_ORIGINS = [
  'https://docs.athelas.com',
  // Another domain for the same Mintlify site, with the same gate.
  'https://trainings.air.athelas.com',
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
const TERMS_VERSION_HEADERS = [
  'terms_version', 'in_effect_from', 'in_effect_until', 'popup_text', 'terms_text', 'note',
];
const COL = Object.fromEntries(CONSENT_HEADERS.map((h, i) => [h, i + 1]));
const VCOL = Object.fromEntries(VISIT_HEADERS.map((h, i) => [h, i + 1]));
// Staff domains. Matched exactly, so subdomains and look-alikes don't count.
const INTERNAL_DOMAINS = ['athelas.com', 'commure.com'];
const INTERNAL_CONSENTS = 'Internal consents';
const INTERNAL_VISITS = 'Internal visits';
const INTERNAL_UNVERIFIED_NOTE = 'internal domain, not verified yet';

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
  getSheet(INTERNAL_CONSENTS, CONSENT_HEADERS);
  getSheet(INTERNAL_VISITS, VISIT_HEADERS);
  getSheet('Terms versions', TERMS_VERSION_HEADERS);
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
    // page and user_agent columns stay for layout but are no longer collected.
    v.terms_version, 'pending', '', '', '', '', v.device_id,
  ];
  const note = (msg) => {
    row[COL.note - 1] = msg;
    sheet.appendRow(row);
  };

  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(v.consent_id) || findConsentRow(v.consent_id) ||
      findConsentRow(v.consent_id, INTERNAL_CONSENTS)) {
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
  if (isInternalEmail(email)) row[COL.note - 1] = INTERNAL_UNVERIFIED_NOTE;
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
  if (isInternalEmail(sheet.getRange(r, COL.email).getValue())) moveToInternal_([v.consent_id]);
}

function handleVisit(v) {
  const paths = v.paths.split('\n').map((p) => p.trim()).filter(Boolean).slice(0, MAX_PATHS_PER_EVENT);
  if (!paths.length) return;
  let r = findConsentRow(v.consent_id);
  let tab = 'Consents';
  let visitTab = 'Visits';
  if (!r) {
    r = findConsentRow(v.consent_id, INTERNAL_CONSENTS);
    if (r) {
      tab = INTERNAL_CONSENTS;
      visitTab = INTERNAL_VISITS;
    }
  }
  const consents = getSheet(tab, CONSENT_HEADERS);
  const email = r ? consents.getRange(r, COL.email).getValue() : '';
  const status = r ? consents.getRange(r, COL.status).getValue() : 'unknown consent';
  const now = new Date();
  const rows = paths.map((p, i) => [
    // The referrer column stays for layout but is no longer collected.
    now, v.consent_id, email, status, p.slice(0, 300), '', v.device_id, v.terms_version,
  ]);
  const sheet = getSheet(visitTab, VISIT_HEADERS);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// ---- Internal staff -------------------------------------------------------------
// Verified Athelas and Commure consents live in their own tabs. See the header.

function isInternalEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  return at > 0 && INTERNAL_DOMAINS.indexOf(e.slice(at + 1)) >= 0;
}

// Moves the given consents out of Consents, and their visits out of Visits, into
// the internal tabs. Visits logged before verification are marked verified too.
// Callers hold the script lock.
function moveToInternal_(consentIds) {
  const ids = new Set(consentIds.map(String));
  if (!ids.size) return { consents: 0, visits: 0 };
  const consents = getSheet('Consents', CONSENT_HEADERS);
  const visits = getSheet('Visits', VISIT_HEADERS);
  const width = CONSENT_HEADERS.length;
  const vwidth = VISIT_HEADERS.length;

  const consentRows = [];
  const consentValues = [];
  dataRows_(consents).forEach((r, i) => {
    if (!ids.has(String(r[COL.consent_id - 1]))) return;
    const row = r.slice(0, width);
    if (row[COL.note - 1] === INTERNAL_UNVERIFIED_NOTE) row[COL.note - 1] = '';
    consentRows.push(i + 2);
    consentValues.push(row);
  });
  const visitRows = [];
  const visitValues = [];
  dataRows_(visits).forEach((r, i) => {
    if (!ids.has(String(r[VCOL.consent_id - 1]))) return;
    const row = r.slice(0, vwidth);
    row[VCOL.consent_status - 1] = 'verified';
    visitRows.push(i + 2);
    visitValues.push(row);
  });

  // Copy before deleting, so a failure in between duplicates rows rather than losing them.
  appendRows_(getSheet(INTERNAL_CONSENTS, CONSENT_HEADERS), consentValues);
  appendRows_(getSheet(INTERNAL_VISITS, VISIT_HEADERS), visitValues);
  deleteRows_(consents, consentRows);
  deleteRows_(visits, visitRows);
  return { consents: consentRows.length, visits: visitRows.length };
}

// Run once from the editor: moves verified internal consents already in Consents,
// and their visits, to the internal tabs.
function moveInternalRows() {
  return moveExistingInternal_(false);
}

// Run from the editor: logs what moveInternalRows would move, moves nothing.
function previewInternalMove() {
  return moveExistingInternal_(true);
}

function moveExistingInternal_(dryRun) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const consentRows = dataRows_(getSheet('Consents', CONSENT_HEADERS));
    const ids = consentRows
      .filter((r) => r[COL.status - 1] === 'verified' && isInternalEmail(r[COL.email - 1]))
      .map((r) => String(r[COL.consent_id - 1]));
    let result;
    if (dryRun) {
      const idSet = new Set(ids);
      const visits = dataRows_(getSheet('Visits', VISIT_HEADERS))
        .filter((r) => idSet.has(String(r[VCOL.consent_id - 1]))).length;
      result = { consents: ids.length, visits: visits };
    } else {
      result = moveToInternal_(ids);
    }
    // Unverified internal rows stay put; flag the ones made before the note existed.
    let flagged = 0;
    const consents = getSheet('Consents', CONSENT_HEADERS);
    dataRows_(consents).forEach((r, i) => {
      if (r[COL.status - 1] !== 'verified' && isInternalEmail(r[COL.email - 1]) && !r[COL.note - 1]) {
        if (!dryRun) consents.getRange(i + 2, COL.note).setValue(INTERNAL_UNVERIFIED_NOTE);
        flagged++;
      }
    });
    result.mode = dryRun ? 'preview' : 'move';
    result.flagged_unverified = flagged;
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function appendRows_(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// ---- Retention ------------------------------------------------------------------
// Privacy notice: "We keep this information while you have access and for six years
// after your last access, or longer if needed for a legal claim or tax or financial
// reasons." A person's last access is their latest agreement, confirmation, or page
// view, across every consent_id under their email. Once that is more than
// RETENTION_YEARS old, everything about them is deleted: their Consents, Visits, and
// Raw events rows (internal tabs included), and the Form's own copy of their
// submissions. Emails listed on
// the "Legal hold" tab are never deleted. Rows that can't be tied to an email (for
// example a bad consent_id) go once their own timestamp is past the cutoff.
// Not covered: the confirmation emails in the sending account's Sent folder.
const RETENTION_YEARS = 6;
const RETENTION_LOG_HEADERS = [
  'ran_at', 'mode', 'cutoff', 'people', 'consents_rows', 'visits_rows', 'raw_rows', 'form_responses',
];

// Daily trigger target.
function purgeExpired() {
  return enforceRetention_(false);
}

// Run from the editor: logs what a purge would delete, deletes nothing.
function previewRetention() {
  return enforceRetention_(true);
}

// Run once from the editor to schedule purgeExpired daily around 3 AM.
function installRetentionTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'purgeExpired')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('purgeExpired').timeBased().everyDays(1).atHour(3).create();
}

function enforceRetention_(dryRun) {
  const ss = spreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);

    const consents = getSheet('Consents', CONSENT_HEADERS);
    const visits = getSheet('Visits', VISIT_HEADERS);
    const internalConsents = getSheet(INTERNAL_CONSENTS, CONSENT_HEADERS);
    const internalVisits = getSheet(INTERNAL_VISITS, VISIT_HEADERS);
    const raw = ss.getSheets().find((sh) => sh.getFormUrl());
    const holdSheet = getSheet('Legal hold', ['email', 'reason', 'added_by', 'added_at']);
    const holds = dataRows_(holdSheet).map((r) => String(r[0]).trim().toLowerCase()).filter(Boolean);

    const plan = planRetention_(dataRows_(consents), dataRows_(visits), raw ? dataRows_(raw) : [], holds, cutoff,
      dataRows_(internalConsents), dataRows_(internalVisits));

    let formDeleted = 0;
    const formId = PropertiesService.getScriptProperties().getProperty('FORM_ID');
    if (formId) {
      const form = FormApp.openById(formId);
      form.getResponses().forEach((resp) => {
        const values = {};
        resp.getItemResponses().forEach((ir) => {
          values[ir.getItem().getTitle()] = String(ir.getResponse() || '');
        });
        if (shouldPurge_(plan, values.email, values.consent_id, resp.getTimestamp())) {
          formDeleted++;
          if (!dryRun) form.deleteResponse(resp.getId());
        }
      });
    }

    if (!dryRun) {
      deleteRows_(consents, plan.consentRows);
      deleteRows_(visits, plan.visitRows);
      deleteRows_(internalConsents, plan.internalConsentRows);
      deleteRows_(internalVisits, plan.internalVisitRows);
      if (raw) deleteRows_(raw, plan.rawRows);
    }

    // The log's consents and visits counts include the internal tabs.
    const counts = [
      now, dryRun ? 'preview' : 'purge', cutoff, plan.people.length,
      plan.consentRows.length + plan.internalConsentRows.length,
      plan.visitRows.length + plan.internalVisitRows.length, plan.rawRows.length, formDeleted,
    ];
    getSheet('Retention log', RETENTION_LOG_HEADERS).appendRow(counts);
    console.log(JSON.stringify({ mode: counts[1], people: counts[3], consents: counts[4],
      visits: counts[5], raw: counts[6], form: counts[7] }));
    return counts;
  } finally {
    lock.releaseLock();
  }
}

// Pure planning step: which people and which sheet rows (1-based, header = row 1)
// to delete. Kept free of Apps Script services so it can be tested on plain arrays.
function planRetention_(consentRows, visitRows, rawRows, holds, cutoff, internalConsentRows, internalVisitRows) {
  const iConsents = internalConsentRows || [];
  const iVisits = internalVisitRows || [];
  const cut = cutoff.getTime();
  const held = new Set(holds.map((e) => String(e).trim().toLowerCase()));
  const idToEmail = {};
  const last = {};
  const touch = (email, when) => {
    const t = toMs_(when);
    if (!email || t === null) return;
    if (!(email in last) || t > last[email]) last[email] = t;
  };

  consentRows.concat(iConsents).forEach((r) => {
    const id = String(r[COL.consent_id - 1]);
    const email = String(r[COL.email - 1]).trim().toLowerCase();
    if (id && email) idToEmail[id] = email;
    touch(email, r[COL.created_at - 1]);
    touch(email, r[COL.verified_at - 1]);
  });
  visitRows.concat(iVisits).forEach((r) => {
    const email = String(r[2]).trim().toLowerCase() || idToEmail[String(r[1])];
    touch(email, r[0]);
  });
  // Raw events columns: Timestamp, then the Form questions in FIELDS order.
  const rawEmail = (r) =>
    String(r[1 + FIELDS.indexOf('email')]).trim().toLowerCase() || idToEmail[String(r[1 + FIELDS.indexOf('consent_id')])];
  rawRows.forEach((r) => touch(rawEmail(r), r[0]));

  const expired = new Set(Object.keys(last).filter((e) => last[e] < cut && !held.has(e)));
  const plan = {
    people: [...expired], expired, held, idToEmail, cut,
    consentRows: [], visitRows: [], rawRows: [], internalConsentRows: [], internalVisitRows: [],
  };
  const purgeConsents = (rows, out) => rows.forEach((r, i) => {
    if (shouldPurge_(plan, r[COL.email - 1], r[COL.consent_id - 1], r[COL.created_at - 1])) out.push(i + 2);
  });
  const purgeVisits = (rows, out) => rows.forEach((r, i) => {
    if (shouldPurge_(plan, r[2], r[1], r[0])) out.push(i + 2);
  });
  purgeConsents(consentRows, plan.consentRows);
  purgeConsents(iConsents, plan.internalConsentRows);
  purgeVisits(visitRows, plan.visitRows);
  purgeVisits(iVisits, plan.internalVisitRows);
  rawRows.forEach((r, i) => {
    if (shouldPurge_(plan, r[1 + FIELDS.indexOf('email')], r[1 + FIELDS.indexOf('consent_id')], r[0])) plan.rawRows.push(i + 2);
  });
  return plan;
}

function shouldPurge_(plan, email, consentId, when) {
  const e = String(email || '').trim().toLowerCase() || plan.idToEmail[String(consentId || '')] || '';
  if (e) return plan.expired.has(e);
  // No email to go on: judge the row by its own date.
  const t = toMs_(when);
  return t !== null && t < plan.cut;
}

function dataRows_(sheet) {
  const n = sheet.getLastRow() - 1;
  return n > 0 ? sheet.getRange(2, 1, n, sheet.getLastColumn()).getValues() : [];
}

// Deletes the given 1-based rows, bottom-up in contiguous runs.
function deleteRows_(sheet, rows) {
  if (!rows.length) return;
  // Sheets refuses to delete every non-frozen row, so keep a spare one.
  if (sheet.getMaxRows() - rows.length <= sheet.getFrozenRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  const sorted = rows.slice().sort((a, b) => b - a);
  let i = 0;
  while (i < sorted.length) {
    let start = sorted[i];
    let count = 1;
    while (i + count < sorted.length && sorted[i + count] === start - 1) {
      start--;
      count++;
    }
    sheet.deleteRows(start, count);
    i += count;
  }
}

function toMs_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const t = (v instanceof Date ? v : new Date(v)).getTime();
  return isNaN(t) ? null : t;
}

function findConsentRow(id, tab) {
  if (!id) return null;
  const sheet = getSheet(tab || 'Consents', CONSENT_HEADERS);
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
