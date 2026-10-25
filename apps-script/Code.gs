/**
 * HØBK tilmeldinger — modtager til appen (login med kode på e-mail).
 *
 * Opsætning (én gang):
 *  1. Gå til script.google.com → Nyt projekt (eller: et Google Sheet → Udvidelser → Apps Script).
 *  2. Erstat indholdet med denne fil → Gem. (Står scriptet alene, opretter setup() selv arket.)
 *  3. Vælg funktionen "setup" i menuen øverst → Kør → godkend adgang (Sheets + send e-mail).
 *     Loggen viser en NØGLE — gem den som GitHub-secret REG_KEY.
 *  4. Implementer → Ny implementering → Type: Webapp
 *       Udfør som: Mig · Hvem har adgang: Alle → Implementer.
 *     Kopiér webapp-URL'en (slutter på /exec) — gem den som GitHub-secret REG_URL
 *     og skriv den i config.json ("registrationUrl").
 *  Efter ændringer i koden: Implementer → Administrer implementeringer → rediger → Ny version.
 *
 * Faner i arket (oprettes automatisk):
 *  Tilmeldinger — hvert svar (synkroniseres til GitHub, UDEN e-mails)
 *  Spillere     — hvem har bekræftet hvilken e-mail (bliver i Google — kommer aldrig i GitHub)
 *  Koder        — engangskoder (gemmes kun som hash) · Sessioner — login-nøgler (gemmes kun som hash)
 *
 * Alle kald er POST {action: ...} undtagen offentlig status og synkronisering:
 *  request  {email, playerId, playerName}       → sender 6-cifret kode (gyldig 15 min)
 *  verify   {email, code}                        → {token, player}
 *  me       {token}                              → {player}
 *  register {token, type, eventId, status, label}→ gemmer svar for den indloggede spiller (status 'ryd' fjerner svaret)
 *  lineup   {token, eventId, team, status, squad[], games[], note} → holdopstilling (kun holdledere, se fanen Ledere)
 *  leaders / setLeader {token, email, name, teams[]} → administrator (ADMIN_PLAYER_IDS) udnævner holdledere
 *  follow   {token, tid, title, on}              → følg/stop med at følge en turnering (fanen Følger)
 *  notify   {key, items[{ids[], title, lines[], url}]} → GitHub sender nyt om turneringer; mail til dem der følger
 *           svarer med push-jobs, som GitHub sender videre som push-notifikationer (kræver VAPID-nøglen)
 *  push     {token, sub{endpoint, keys{p256dh, auth}}, on, device} → tilmeld/afmeld push på en telefon
 *  prefs    {token, mail}                        → mail ved nyt til/fra (push påvirkes ikke)
 *  pushGone {key, endpoints[]}                   → GitHub melder døde push-adresser, de slettes
 *  GET ?action=follows&key=NØGLE → hvilke turneringer der følges (kun id'er, ingen e-mails)
 *  logout   {token}
 *  GET ?action=status          → seneste svar pr. (begivenhed, spiller) — offentlig, uden e-mails
 *  GET ?action=all&key=NØGLE   → alle svar (til GitHub-synkronisering) — uden e-mails
 */

var SCRIPT_VERSION = '2026-10-25.4';   // vises af ?action=version — så GitHub kan se om den nye version er implementeret
var CLUB = 'Hørsholm Badminton Klub';
var TYPES = { match: ['ja', 'nej', 'maaske', 'ryd'], training: ['ja', 'nej', 'ryd'] };   // ryd = fjern sit svar
var SHEETS = {
  Tilmeldinger: ['tidspunkt', 'type', 'eventId', 'playerId', 'playerName', 'status', 'label'],
  Spillere: ['playerId', 'playerName', 'email', 'bekræftet', 'sidst set'],
  Koder: ['tidspunkt', 'email', 'kodeHash', 'playerId', 'playerName', 'forsøg', 'brugt'],
  Sessioner: ['tokenHash', 'playerId', 'playerName', 'email', 'oprettet', 'sidst brugt', 'aktiv'],
  Ledere: ['email', 'navn', 'hold'],
  Opstillinger: ['tidspunkt', 'eventId', 'hold', 'status', 'gemtAf', 'data'],
  'Følger': ['email', 'playerId', 'playerName', 'turneringId', 'titel', 'tidspunkt'],
  Notifikationer: ['tidspunkt', 'email', 'emne', 'turneringer'],
  Push: ['email', 'playerId', 'endpoint', 'p256dh', 'auth', 'tidspunkt', 'enhed'],
  Indstillinger: ['email', 'mail']
};
// Administrator(er): må udnævne holdledere i appen. Badmintonplayer-spiller-id'er.
// Den FØRSTE e-mail der bekræfter navnet (fanen Spillere) ejer rollen — en anden e-mail med samme navn bliver ikke admin.
var ADMIN_PLAYER_IDS = ['12813'];   // Anders Vedsted Nørrelund
// Administratorer ud fra login-e-mail (gemt som SHA-256 af e-mailen med små bogstaver, så adressen ikke står i koden).
// Ny: kør  printf '%s' 'navn@eksempel.dk' | sha256sum  og tilføj tallet.
var ADMIN_EMAIL_SHA256 = ['7b69eef2050ca0d7e3bbf7fefc71077c794fc9050e5aa89aee8374eb789f09d6'];   // Christoffer (udvikler)
var CODE_MINUTES = 15, MAX_CODES_PER_HOUR = 4, MAX_TRIES = 5, SESSION_DAYS = 365;

// Virker både når scriptet er oprettet fra et Google Sheet (Udvidelser → Apps Script)
// og som selvstændigt projekt på script.google.com — så opretter setup() selv arket.
function ss_() {
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { active = null; }
  if (active) return active;
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var created = SpreadsheetApp.create('HØBK tilmeldinger');
  props.setProperty('SHEET_ID', created.getId());
  return created;
}

function setup() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, SHEETS[name].length).setFontWeight('bold');
    }
  });
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, ''); props.setProperty('KEY', key); }
  Logger.log('NØGLE til GitHub-secret REG_KEY: ' + key);
  // Fjern standardfanen "Ark1"/"Sheet1" hvis arket lige er oprettet og fanen er tom
  ['Ark1', 'Sheet1'].forEach(function (n) { var x = ss.getSheetByName(n); if (x && x.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(x); });
  Logger.log('Google Sheet: ' + ss.getUrl());
  Logger.log('E-mails tilbage i dag (Google-kvote): ' + MailApp.getRemainingDailyQuota());
}

// ---------- hjælpere ----------
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function sh_(name) { var s = ss_().getSheetByName(name); if (!s) { setup(); s = ss_().getSheetByName(name); } return s; }
function clean_(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function safe_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }   // undgå formel-injektion i Sheets
function hash_(s) {
  var salt = PropertiesService.getScriptProperties().getProperty('KEY') || '';
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + s)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function data_(name) { var s = sh_(name); return s.getLastRow() < 2 ? [] : s.getRange(2, 1, s.getLastRow() - 1, SHEETS[name].length).getValues(); }
function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
function withLock_(fn) { var l = LockService.getScriptLock(); l.waitLock(10000); try { return fn(); } finally { l.releaseLock(); } }

function session_(token) {
  if (!token) return null;
  var h = hash_('t:' + token), s = sh_('Sessioner'), rows = data_('Sessioner');
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r[0] === h && r[6] === true) {
      if ((new Date() - new Date(r[4])) / 86400000 > SESSION_DAYS) return null;
      s.getRange(i + 2, 6).setValue(new Date());
      return { row: i + 2, playerId: String(r[1]), playerName: String(r[2]), email: String(r[3]) };
    }
  }
  return null;
}

// ---------- handlinger ----------
function request_(b) {
  var email = clean_(b.email, 120).toLowerCase(), pid = clean_(b.playerId, 80), pname = clean_(b.playerName, 80);
  if (!validEmail_(email)) return { ok: false, error: 'Ugyldig e-mail' };
  if (!pid || !pname) return { ok: false, error: 'Vælg dit navn' };
  return withLock_(function () {
    var hourAgo = new Date(Date.now() - 3600000);
    var recent = data_('Koder').filter(function (r) { return r[1] === email && new Date(r[0]) > hourAgo; }).length;
    if (recent >= MAX_CODES_PER_HOUR) return { ok: false, error: 'For mange koder — prøv igen om en time' };
    if (MailApp.getRemainingDailyQuota() < 1) return { ok: false, error: 'Klubbens e-mail-kvote er brugt i dag — prøv i morgen' };
    var code = String(Math.floor(100000 + Math.random() * 900000));
    sh_('Koder').appendRow([new Date(), email, hash_('c:' + email + ':' + code), safe_(pid), safe_(pname), 0, false]);
    MailApp.sendEmail({
      to: email,
      subject: 'Din HØBK-kode: ' + code,
      body: 'Hej ' + pname.split(' ')[0] + '\n\nDin kode til HØBK-appen er: ' + code +
            '\n\nKoden gælder i ' + CODE_MINUTES + ' minutter. Har du ikke bedt om den, kan du se bort fra denne mail.\n\n' + CLUB,
      name: CLUB
    });
    return { ok: true };
  });
}

function verify_(b) {
  var email = clean_(b.email, 120).toLowerCase(), code = clean_(b.code, 10).replace(/\D/g, '');
  if (!validEmail_(email) || code.length !== 6) return { ok: false, error: 'Forkert kode' };
  return withLock_(function () {
    var s = sh_('Koder'), rows = data_('Koder'), limit = new Date(Date.now() - CODE_MINUTES * 60000);
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      if (r[1] !== email || r[6] === true || new Date(r[0]) < limit) continue;
      if (r[5] >= MAX_TRIES) return { ok: false, error: 'For mange forsøg — bed om en ny kode' };
      if (r[2] !== hash_('c:' + email + ':' + code)) {
        s.getRange(i + 2, 6).setValue(r[5] + 1);
        return { ok: false, error: 'Forkert kode' };
      }
      s.getRange(i + 2, 7).setValue(true);
      var pid = String(r[3]), pname = String(r[4]);
      var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
      sh_('Sessioner').appendRow([hash_('t:' + token), safe_(pid), safe_(pname), email, new Date(), new Date(), true]);
      var sp = sh_('Spillere'), known = data_('Spillere'), found = false;
      for (var j = 0; j < known.length; j++) {
        if (String(known[j][0]) === pid && String(known[j][2]) === email) { sp.getRange(j + 2, 5).setValue(new Date()); found = true; }
      }
      if (!found) sp.appendRow([safe_(pid), safe_(pname), email, new Date(), new Date()]);
      return { ok: true, token: token, player: { id: pid, name: pname, email: email }, role: role_(email, pid), follows: follows_(email) };
    }
    return { ok: false, error: 'Koden er udløbet eller forkert — bed om en ny' };
  });
}

// Holdledere: fanen "Ledere" — én række pr. leder. hold = holdlabels adskilt af komma
// (fx "U15 B, U13 B") eller * for alle hold. Matcher på den e-mail lederen logger ind med.
function sha256hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function isAdmin_(email, playerId) {
  var em = String(email || '').toLowerCase().trim(), pid = String(playerId || '');
  if (em && ADMIN_EMAIL_SHA256.indexOf(sha256hex_(em)) >= 0) return true;
  if (!em || ADMIN_PLAYER_IDS.indexOf(pid) < 0) return false;
  var first = data_('Spillere').filter(function (r) { return String(r[0]) === pid; })
    .sort(function (a, b) { return new Date(a[3]) - new Date(b[3]); })[0];
  return !!first && String(first[2]).toLowerCase().trim() === em;
}

function role_(email, playerId) {
  var em = String(email || '').toLowerCase().trim();
  if (!em) return { leader: false, teams: [] };
  if (isAdmin_(em, playerId)) return { leader: true, all: true, admin: true, teams: [] };
  var teams = [], all = false;
  data_('Ledere').forEach(function (r) {
    if (String(r[0]).toLowerCase().trim() !== em) return;
    String(r[2]).split(',').forEach(function (t) { t = t.trim(); if (t === '*') all = true; else if (t) teams.push(t); });
  });
  return { leader: all || teams.length > 0, all: all, teams: teams };
}

function saveLineup_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var team = clean_(b.team, 60), eventId = clean_(b.eventId, 80);
  var role = role_(ses.email, ses.playerId);
  if (!role.leader || !(role.all || role.teams.indexOf(team) >= 0)) return { ok: false, error: 'Du er ikke holdleder for ' + team };
  if (!/^m:/.test(eventId)) return { ok: false, error: 'Ukendt kamp' };
  var status = ['udkast', 'klar', 'indtastet'].indexOf(b.status) >= 0 ? b.status : 'udkast';
  function people(list) {
    return (list || []).slice(0, 30).map(function (p) { return { id: clean_(p.id, 40), name: clean_(p.name, 80) }; })
      .filter(function (p) { return p.id && p.name; });
  }
  var data = {
    squad: people(b.squad),
    games: (b.games || []).slice(0, 20).map(function (g) { return { k: clean_(g.k, 12), p: (g.p || []).slice(0, 2).map(function (x) { return clean_(x, 40); }) }; }),
    note: clean_(b.note, 300),
    by: ses.playerName
  };
  withLock_(function () {
    sh_('Opstillinger').appendRow([new Date(), safe_(eventId), safe_(team), status, safe_(ses.playerName), JSON.stringify(data)]);
  });
  return { ok: true };
}

// ---------- Administrator: holdledere ----------
function leaders_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var leaders = data_('Ledere').map(function (r) {
    return { email: String(r[0]), name: String(r[1]), teams: String(r[2]).split(',').map(function (t) { return t.trim(); }).filter(String) };
  }).filter(function (l) { return l.email; });
  var emails = {};   // spiller-id → bekræftede e-mails (kun til administrator)
  data_('Spillere').forEach(function (r) { var id = String(r[0]); (emails[id] = emails[id] || []); if (emails[id].indexOf(String(r[2])) < 0) emails[id].push(String(r[2])); });
  return { ok: true, leaders: leaders, emails: emails, stats: stats_() };
}

function setLeader_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var email = clean_(b.email, 120).toLowerCase();
  if (!validEmail_(email)) return { ok: false, error: 'Ugyldig e-mail' };
  var teams = (b.teams || []).map(function (t) { return clean_(t, 60); }).filter(function (t) { return t && t.toLowerCase() !== 'admin'; });
  var name = clean_(b.name, 80);
  return withLock_(function () {
    var sh = sh_('Ledere'), rows = data_('Ledere');
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0]).toLowerCase().trim() === email) sh.deleteRow(i + 2);
    }
    if (teams.length) sh.appendRow([email, safe_(name), safe_(teams.join(', '))]);
    return { ok: true };
  });
}

function lineups_() {
  var latest = {};
  data_('Opstillinger').forEach(function (r) {
    var ts = r[0] instanceof Date ? r[0].getTime() : 0, id = String(r[1]);
    if (latest[id] && latest[id].t > ts) return;
    var d = {}; try { d = JSON.parse(r[5]); } catch (e) { d = {}; }
    latest[id] = { e: id, team: String(r[2]), status: String(r[3]), t: ts, squad: d.squad || [], games: d.games || [], note: d.note || '', by: d.by || String(r[4]) };
  });
  return Object.keys(latest).map(function (k) { return latest[k]; });
}

// ---------- Følg turneringer + notifikationer ----------
function follows_(email) {
  var em = String(email || '').toLowerCase();
  return data_('Følger').filter(function (r) { return String(r[0]).toLowerCase() === em; }).map(function (r) { return String(r[3]); });
}

function follow_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var tid = clean_(b.tid, 40);
  if (!/^x?[0-9a-f]+$/i.test(tid)) return { ok: false, error: 'Ukendt turnering' };
  return withLock_(function () {
    var sh = sh_('Følger'), rows = data_('Følger'), em = ses.email.toLowerCase();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0]).toLowerCase() === em && String(rows[i][3]) === tid) sh.deleteRow(i + 2);
    }
    if (b.on) {
      if (follows_(em).length >= 60) return { ok: false, error: 'Du følger allerede 60 turneringer' };
      sh.appendRow([em, safe_(ses.playerId), safe_(ses.playerName), safe_(tid), safe_(clean_(b.title, 120)), new Date()]);
    }
    return { ok: true, follows: follows_(em) };
  });
}

function mailOn_(email) {
  var em = String(email || '').toLowerCase(), on = true;
  data_('Indstillinger').forEach(function (r) { if (String(r[0]).toLowerCase() === em) on = r[1] !== false && String(r[1]).toUpperCase() !== 'FALSE'; });
  return on;
}
function settings_(email) {
  var em = String(email || '').toLowerCase();
  return { mail: mailOn_(em), pushDevices: data_('Push').filter(function (r) { return String(r[0]).toLowerCase() === em; }).length };
}
function prefs_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  return withLock_(function () {
    var sh = sh_('Indstillinger'), rows = data_('Indstillinger'), em = ses.email.toLowerCase();
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][0]).toLowerCase() === em) sh.deleteRow(i + 2);
    sh.appendRow([em, !!b.mail]);
    return { ok: true, settings: settings_(em) };
  });
}
function push_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var sub = b.sub || {}, keys = sub.keys || {}, ep = clean_(sub.endpoint, 600);
  if (!/^https:\/\//.test(ep)) return { ok: false, error: 'Ugyldig push-adresse' };
  return withLock_(function () {
    var sh = sh_('Push'), rows = data_('Push'), em = ses.email.toLowerCase();
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][2]) === ep) sh.deleteRow(i + 2);
    if (b.on) {
      if (!keys.p256dh || !keys.auth) return { ok: false, error: 'Ugyldig push-adresse' };
      sh.appendRow([em, safe_(ses.playerId), ep, clean_(keys.p256dh, 200), clean_(keys.auth, 100), new Date(), safe_(clean_(b.device, 60))]);
    }
    return { ok: true, settings: settings_(em) };
  });
}
function pushGone_(b) {
  var key = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!key || b.key !== key) return { ok: false, error: 'Forkert nøgle' };
  var gone = (b.endpoints || []).map(String);
  return withLock_(function () {
    var sh = sh_('Push'), rows = data_('Push'), n = 0;
    for (var i = rows.length - 1; i >= 0; i--) if (gone.indexOf(String(rows[i][2])) >= 0) { sh.deleteRow(i + 2); n++; }
    return { ok: true, removed: n };
  });
}

// Kaldes af GitHub (notify_turneringer.py) efter hver dataopdatering — én samlet mail pr. person.
function notify_(b) {
  var key = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!key || b.key !== key) return { ok: false, error: 'Forkert nøgle' };
  var items = (b.items || []).slice(0, 200), byEmail = {};
  var rows = data_('Følger');
  items.forEach(function (it) {
    var ids = (it.ids || []).map(String);
    rows.forEach(function (r) {
      if (ids.indexOf(String(r[3])) < 0) return;
      var em = String(r[0]).toLowerCase();
      (byEmail[em] = byEmail[em] || { name: String(r[2]), items: [] });
      if (byEmail[em].items.indexOf(it) < 0) byEmail[em].items.push(it);
    });
  });
  var sent = 0, skipped = 0, log = sh_('Notifikationer'), pushRows = data_('Push'), jobs = [];
  Object.keys(byEmail).forEach(function (em) {
    var p = byEmail[em], list = p.items;
    pushRows.forEach(function (r) {
      if (String(r[0]).toLowerCase() !== em) return;
      list.slice(0, 5).forEach(function (it) {
        jobs.push({ endpoint: String(r[2]), keys: { p256dh: String(r[3]), auth: String(r[4]) },
                    title: clean_(it.title, 80), body: (it.lines || []).slice(0, 3).map(function (l) { return clean_(l, 120); }).join('\n'),
                    url: clean_(it.url, 200), tag: 't' + String(it.ids[0]) });
      });
    });
    if (!mailOn_(em)) return;
    if (MailApp.getRemainingDailyQuota() < 2) { skipped++; return; }
    var subject = list.length === 1 ? 'HØBK · ' + clean_(list[0].title, 80) + ': ' + clean_(list[0].lines[0] || 'nyt', 80)
                                    : 'HØBK · nyt om ' + list.length + ' turneringer du følger';
    var body = 'Hej ' + p.name.split(' ')[0] + '\n\n' + list.map(function (it) {
      return clean_(it.title, 120) + (it.when ? ' (' + clean_(it.when, 60) + ')' : '') + '\n' +
        (it.lines || []).slice(0, 8).map(function (l) { return '  • ' + clean_(l, 200); }).join('\n') +
        (it.url ? '\n  ' + clean_(it.url, 200) : '');
    }).join('\n\n') + '\n\nDu får denne mail, fordi du følger turneringen i HØBK-appen. Tryk "Følger" på turneringen i appen for at stoppe.\n\n' + CLUB;
    MailApp.sendEmail({ to: em, subject: subject, body: body, name: CLUB });
    log.appendRow([new Date(), em, subject, list.map(function (it) { return it.ids[0]; }).join(', ')]);
    sent++;
  });
  return { ok: true, sent: sent, skipped: skipped, push: jobs };
}

// Antal brugere — kun tal, ingen e-mails (bruges af sync_tilmeldinger.py og administrator-siden)
function stats_() {
  var now = Date.now(), day = 86400000;
  var players = {}, emails = {};
  data_('Spillere').forEach(function (r) { if (String(r[2])) { players[String(r[0])] = 1; emails[String(r[2]).toLowerCase()] = 1; } });
  var active7 = {}, active30 = {}, sessions = 0;
  data_('Sessioner').forEach(function (r) {
    if (r[6] !== true) return;
    sessions++;
    var seen = r[5] instanceof Date ? r[5].getTime() : 0, pid = String(r[1]);
    if (now - seen < 7 * day) active7[pid] = 1;
    if (now - seen < 30 * day) active30[pid] = 1;
  });
  var fol = data_('Følger'), followers = {}, teamF = 0, tourF = 0;
  fol.forEach(function (r) { followers[String(r[0]).toLowerCase()] = 1; if (/^f\d+$/.test(String(r[3]))) teamF++; else tourF++; });
  var push = data_('Push'), pushUsers = {};
  push.forEach(function (r) { pushUsers[String(r[0]).toLowerCase()] = 1; });
  return { players: Object.keys(players).length, emails: Object.keys(emails).length, loggedIn: sessions,
           active7: Object.keys(active7).length, active30: Object.keys(active30).length,
           followers: Object.keys(followers).length, teamFollows: teamF, tourFollows: tourF,
           pushDevices: push.length, pushUsers: Object.keys(pushUsers).length,
           mailOff: data_('Indstillinger').filter(function (r) { return r[1] === false || String(r[1]).toUpperCase() === 'FALSE'; }).length,
           leaders: data_('Ledere').length };
}

function register_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var type = clean_(b.type, 10), status = clean_(b.status, 10), eventId = clean_(b.eventId, 80);
  if (!TYPES[type] || TYPES[type].indexOf(status) < 0 || !eventId) return { ok: false, error: 'Ugyldigt svar' };
  withLock_(function () {
    sh_('Tilmeldinger').appendRow([new Date(), type, safe_(eventId), safe_(ses.playerId), safe_(ses.playerName), status, safe_(clean_(b.label, 120))]);
  });
  return { ok: true };
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Ugyldig forespørgsel' }); }
  try {
    switch (b.action) {
      case 'request': return json_(request_(b));
      case 'verify': return json_(verify_(b));
      case 'register': return json_(register_(b));
      case 'lineup': return json_(saveLineup_(b));
      case 'leaders': return json_(leaders_(b));
      case 'setLeader': return json_(setLeader_(b));
      case 'follow': return json_(follow_(b));
      case 'notify': return json_(notify_(b));
      case 'push': return json_(push_(b));
      case 'prefs': return json_(prefs_(b));
      case 'pushGone': return json_(pushGone_(b));
      case 'me': var s = session_(b.token); return json_(s ? { ok: true, player: { id: s.playerId, name: s.playerName, email: s.email }, role: role_(s.email, s.playerId), follows: follows_(s.email), settings: settings_(s.email) } : { ok: false, error: 'login' });
      case 'logout':
        var se = session_(b.token); if (se) sh_('Sessioner').getRange(se.row, 7).setValue(false);
        return json_({ ok: true });
      default: return json_({ ok: false, error: 'Ukendt handling' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'Serverfejl — prøv igen' });
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'status';
  if (action === 'version') return json_({ ok: true, version: SCRIPT_VERSION });
  if (action === 'follows') {
    var k = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!k || e.parameter.key !== k) return json_({ ok: false, error: 'Forkert nøgle' });
    var ids = {}; data_('Følger').forEach(function (r) { ids[String(r[3])] = 1; });
    return json_({ ok: true, follows: Object.keys(ids) });
  }
  var rows = data_('Tilmeldinger');
  if (action === 'all') {
    var key = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!key || e.parameter.key !== key) return json_({ ok: false, error: 'Forkert nøgle' });
    return json_({ ok: true, version: SCRIPT_VERSION, stats: stats_(), lineups: lineups_(), rows: rows.map(function (r) {
      return { ts: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), type: r[1], eventId: String(r[2]),
               playerId: String(r[3]), playerName: String(r[4]), status: r[5], label: String(r[6]) };
    }) });
  }
  var latest = {};
  rows.forEach(function (r) {
    var k = r[2] + '|' + r[3], ts = r[0] instanceof Date ? r[0].getTime() : 0;
    if (!latest[k] || latest[k].t <= ts) latest[k] = { e: String(r[2]), p: String(r[3]), n: String(r[4]), s: r[5], t: ts };
  });
  return json_({ ok: true, updated: new Date().toISOString(),
                 status: Object.keys(latest).map(function (k) { return latest[k]; }).filter(function (x) { return x.s !== 'ryd'; }), lineups: lineups_() });
}

// --- slut på filen (denne linje må gerne mangle ved kopiering) ---
