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
 *  request  for forældre: playerId "p:<navn>" + children[{id, name}] · children {token, children[]} → ret sine børn
 *  acts {token} / GET ?action=acts → aktiviteter · actSave / actDel (administrator) · taskSign {token, act, task, on}
 *  rooms    {token, groups[]}                    → mine snak-rum (hold + træningsgrupper) med seneste aktivitet + nyheder til mig
 *  messages {token, room}                        → beskeder i et rum (kun medlemmer) · post {token, room, text} · delMsg {token, id}
 *  mute     {token, room, on}                    → ingen push for et rum
 *  newsSave {token, title, text, to[], push} / newsDel {token, id} / newsList {token} → administrator skriver nyheder
 *  GET ?action=news            → offentlige nyheder (til alle) · GET ?action=pushqueue&key=NØGLE → push-køen (tømmes)
 *  GET ?action=status          → seneste svar pr. (begivenhed, spiller) — offentlig, uden e-mails
 *  GET ?action=all&key=NØGLE   → alle svar (til GitHub-synkronisering) — uden e-mails
 */

var SCRIPT_VERSION = '2026-10-31.5';   // vises af ?action=version — så GitHub kan se om den nye version er implementeret
var CLUB = 'Hørsholm Badminton Klub';
var TYPES = { match: ['ja', 'nej', 'maaske', 'ryd'], training: ['ja', 'nej', 'ryd'] };   // ryd = fjern sit svar
var SHEETS = {
  Tilmeldinger: ['tidspunkt', 'type', 'eventId', 'playerId', 'playerName', 'status', 'label'],
  Spillere: ['playerId', 'playerName', 'email', 'bekræftet', 'sidst set'],
  Koder: ['tidspunkt', 'email', 'kodeHash', 'playerId', 'playerName', 'forsøg', 'brugt', 'børn'],
  Sessioner: ['tokenHash', 'playerId', 'playerName', 'email', 'oprettet', 'sidst brugt', 'aktiv'],
  Ledere: ['email', 'navn', 'hold'],
  Opstillinger: ['tidspunkt', 'eventId', 'hold', 'status', 'gemtAf', 'data'],
  'Følger': ['email', 'playerId', 'playerName', 'turneringId', 'titel', 'tidspunkt'],
  Notifikationer: ['tidspunkt', 'email', 'emne', 'turneringer'],
  Push: ['email', 'playerId', 'endpoint', 'p256dh', 'auth', 'tidspunkt', 'enhed'],
  Indstillinger: ['email', 'mail'],
  Beskeder: ['id', 'tidspunkt', 'rum', 'playerId', 'playerName', 'email', 'tekst', 'slettet'],
  Nyheder: ['id', 'tidspunkt', 'titel', 'tekst', 'til', 'af', 'slettet'],
  Grupper: ['email', 'playerId', 'grupper'],
  'Lydløs': ['email', 'rum'],
  'Forældre': ['email', 'forælderId', 'forælderNavn', 'barnId', 'barnNavn', 'tidspunkt'],
  Aktiviteter: ['id', 'oprettet', 'navn', 'beskrivelse', 'start', 'slut', 'kalender', 'til', 'af', 'slettet', 'opgaver'],
  Opgavetilmeldinger: ['tidspunkt', 'aktivitetId', 'opgaveId', 'email', 'playerId', 'navn', 'status'],
  'PushKø': ['tidspunkt', 'endpoint', 'p256dh', 'auth', 'titel', 'tekst', 'url', 'tag']
};
// Administrator(er): må udnævne holdledere i appen. Badmintonplayer-spiller-id'er.
// Den FØRSTE e-mail der bekræfter navnet (fanen Spillere) ejer rollen — en anden e-mail med samme navn bliver ikke admin.
var ADMIN_PLAYER_IDS = ['12813'];   // Anders Vedsted Nørrelund
// Administratorer ud fra login-e-mail (gemt som SHA-256 af e-mailen med små bogstaver, så adressen ikke står i koden).
// Ny: kør  printf '%s' 'navn@eksempel.dk' | sha256sum  og tilføj tallet.
var ADMIN_EMAIL_SHA256 = ['61b300daa9a1d0d7ce2848c73b1207e5c2c98dd5a93a2b66884f460ef587b90f'];   // Christoffer (udvikler)
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
    if (sh.getLastRow() > 0 && sh.getLastColumn() < SHEETS[name].length) {   // ny kolonne i en eksisterende fane
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    }
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
  var kids = /^p:/.test(pid) ? cleanKids_(b.children) : [];
  if (/^p:/.test(pid) && !kids.length) return { ok: false, error: 'Vælg dit barn' };
  return withLock_(function () {
    var hourAgo = new Date(Date.now() - 3600000);
    var recent = data_('Koder').filter(function (r) { return r[1] === email && new Date(r[0]) > hourAgo; }).length;
    if (recent >= MAX_CODES_PER_HOUR) return { ok: false, error: 'For mange koder — prøv igen om en time' };
    if (MailApp.getRemainingDailyQuota() < 1) return { ok: false, error: 'Klubbens e-mail-kvote er brugt i dag — prøv i morgen' };
    var code = String(Math.floor(100000 + Math.random() * 900000));
    sh_('Koder').appendRow([new Date(), email, hash_('c:' + email + ':' + code), safe_(pid), safe_(pname), 0, false, kids.length ? JSON.stringify(kids) : '']);
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
      var kids = []; try { kids = r[7] ? JSON.parse(r[7]) : []; } catch (e) { kids = []; }
      if (kids.length) setKids_(email, pid, pname, kids, true);
      return { ok: true, token: token, player: { id: pid, name: pname, email: email }, role: role_(email, pid), follows: follows_(email), kids: kids_(email) };
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
           leaders: data_('Ledere').length,
           parents: (function () { var p = {}; data_('Forældre').forEach(function (r) { p[String(r[0]).toLowerCase()] = 1; }); return Object.keys(p).length; })() };
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

// ---------- Forældre ----------
// En forælder logger ind med sit eget navn (id "p:<navn>") og vælger sine børn. Børnene står i fanen Forældre
// (én række pr. barn). Forældre er med i børnenes holds snak og får deres nyheder — ligesom spillerne.
function cleanKids_(list) {
  var seen = {};
  return (list || []).slice(0, 8).map(function (k) { return { id: clean_(k && k.id, 40), name: clean_(k && k.name, 80) }; })
    .filter(function (k) { if (!k.id || !k.name || /^p:/.test(k.id) || seen[k.id]) return false; seen[k.id] = 1; return true; });
}
function kids_(email) {
  var em = String(email || '').toLowerCase();
  return data_('Forældre').filter(function (r) { return String(r[0]).toLowerCase() === em; }).map(function (r) { return { id: String(r[3]), name: String(r[4]) }; });
}
function setKids_(email, pid, pname, kids, locked) {   // locked = kaldes inde fra en funktion der allerede har låsen
  var em = String(email || '').toLowerCase();
  var write = function () {
    var sh = sh_('Forældre'), rows = data_('Forældre');
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][0]).toLowerCase() === em) sh.deleteRow(i + 2);
    kids.forEach(function (k) { sh.appendRow([em, safe_(pid), safe_(pname), safe_(k.id), safe_(k.name), new Date()]); });
  };
  if (locked) write(); else withLock_(write);
}
function children_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var kids = cleanKids_(b.children).filter(function (k) { return k.id !== ses.playerId; });
  if (/^p:/.test(ses.playerId) && !kids.length) return { ok: false, error: 'En forælder skal have mindst ét barn' };
  setKids_(ses.email, ses.playerId, ses.playerName, kids);
  return { ok: true, kids: kids_(ses.email) };
}

// ---------- Snak (beskeder i hold og træningsgrupper) + nyheder ----------
// Rum: "h:<leagueGroupTeamID>" for et hold, "g:<gruppe>" for en træningsgruppe.
// Medlem af et hold: har spillet for holdet, følger holdet, er holdleder for det — eller administrator.
// Medlem af en træningsgruppe: har valgt gruppen på Min side (fanen Grupper) — eller administrator.
// Beskeder bliver i Google Sheet — de synkroniseres ALDRIG til GitHub (repoet er offentligt).
var APP_URL = 'https://christoffergroenfeldt-cyber.github.io/Hoebk/';
var TR_GROUPS = ['Ungdom', 'Senior', 'Senior2', 'Voksenfjer', 'Veteran'];
var MSG_MAX = 1000, NEWS_MAX = 3000, MSG_PER_MIN = 10, TAIL = 3000;

// Holdene og deres spillere — hentes fra appens egne data og gemmes i 6 timer
function teams_() {
  var c = CacheService.getScriptCache(), v = c.get('teams1');
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  var map = {};
  try {
    var r = UrlFetchApp.fetch(APP_URL + 'data/holdkampe.json?t=' + Date.now(), { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) JSON.parse(r.getContentText()).teams.forEach(function (t) {
      map[String(t.leagueGroupTeamID)] = { l: String(t.label), p: (t.players || []).map(function (p) { return String(p.id); }) };
    });
  } catch (e) { map = {}; }
  if (Object.keys(map).length) c.put('teams1', JSON.stringify(map), 21600);
  return map;
}
// Sidste n rækker af en fane (beskeder vokser — vi læser kun de nyeste)
function tail_(name, n) {
  var s = sh_(name), last = s.getLastRow();
  if (last < 2) return { rows: [], first: 2 };
  var first = Math.max(2, last - n + 1);
  return { rows: s.getRange(first, 1, last - first + 1, SHEETS[name].length).getValues(), first: first };
}
function text_(s, max) {   // som clean_, men linjeskift bevares
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function ts_(d) { return d instanceof Date ? d.getTime() : (new Date(d).getTime() || 0); }
function newId_(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

// Alle tabeller der skal bruges til at regne medlemskab — læses én gang pr. kald
function ctx_() {
  return { teams: teams_(), fol: data_('Følger'), led: data_('Ledere'), grp: data_('Grupper'), par: data_('Forældre'), admins: {} };
}
function roleIn_(cx, email, pid) {
  var em = String(email || '').toLowerCase().trim(), k = em + '|' + pid;
  if (!(k in cx.admins)) cx.admins[k] = isAdmin_(em, pid);
  if (cx.admins[k]) return { admin: true, all: true, teams: [] };
  var teams = [], all = false;
  cx.led.forEach(function (r) {
    if (String(r[0]).toLowerCase().trim() !== em) return;
    String(r[2]).split(',').forEach(function (t) { t = t.trim(); if (t === '*') all = true; else if (t) teams.push(t); });
  });
  return { admin: false, all: all, teams: teams };
}
// {rumId: titel} for en bruger. strict = kun rum man selv er en del af (ikke dem administrator/leder for alle hold kan se) —
// bruges til push og ulæst-markering, så administratorer ikke får besked om alt.
function memberRooms_(cx, email, pid, strict) {
  var em = String(email || '').toLowerCase().trim(), role = roleIn_(cx, em, pid), out = {};
  if (strict) role = { admin: false, all: false, teams: role.teams };
  var follows = {}; cx.fol.forEach(function (r) { if (String(r[0]).toLowerCase() === em) follows[String(r[3])] = 1; });
  var kids = []; (cx.par || []).forEach(function (r) { if (String(r[0]).toLowerCase() === em) kids.push(String(r[3])); });
  Object.keys(cx.teams).forEach(function (id) {
    var t = cx.teams[id];
    if (role.admin || role.all || role.teams.indexOf(t.l) >= 0 || follows['f' + id] || t.p.indexOf(String(pid)) >= 0 ||
        kids.some(function (k) { return t.p.indexOf(k) >= 0; })) out['h:' + id] = t.l;
  });
  var groups = role.admin ? TR_GROUPS : [];
  cx.grp.forEach(function (r) { if (String(r[0]).toLowerCase() === em) groups = groups.concat(String(r[2]).split(',')); });
  groups.forEach(function (g) { g = g.trim(); if (TR_GROUPS.indexOf(g) >= 0) out['g:' + g] = 'Træning · ' + g; });
  return out;
}
function canModerate_(cx, ses, room) {
  var role = roleIn_(cx, ses.email, ses.playerId);
  if (role.admin || (role.all && /^h:/.test(room))) return true;
  var t = /^h:/.test(room) ? cx.teams[room.slice(2)] : null;
  return !!t && role.teams.indexOf(t.l) >= 0;
}
function muted_(email) {
  var em = String(email || '').toLowerCase(), m = {};
  data_('Lydløs').forEach(function (r) { if (String(r[0]).toLowerCase() === em) m[String(r[1])] = 1; });
  return m;
}
function saveGroups_(ses, groups) {
  var g = (groups || []).map(String).filter(function (x) { return TR_GROUPS.indexOf(x) >= 0; }).join(', ');
  var em = ses.email.toLowerCase(), same = data_('Grupper').filter(function (r) { return String(r[0]).toLowerCase() === em; });
  if (same.length === 1 && String(same[0][2]) === g) return;   // uændret — skriv ikke
  withLock_(function () {
    var sh = sh_('Grupper'), rows = data_('Grupper');
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][0]).toLowerCase() === em) sh.deleteRow(i + 2);
    sh.appendRow([em, safe_(ses.playerId), g]);
  });
}
function newsRows_() {
  return data_('Nyheder').filter(function (r) { return r[0] && !bool_(r[6]); }).map(function (r) {
    return { id: String(r[0]), t: ts_(r[1]), title: String(r[2]), text: String(r[3]),
             to: String(r[4]).split(',').map(function (x) { return x.trim(); }).filter(String), by: String(r[5]) };
  }).sort(function (a, b) { return b.t - a.t; });
}
function newsFor_(rooms, all) {
  var since = Date.now() - 120 * 86400000;
  return newsRows_().filter(function (n) {
    if (n.t < since) return false;
    return all || n.to.indexOf('*') >= 0 || n.to.some(function (x) { return !!rooms[x]; });
  }).slice(0, 30);
}

function rooms_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  if (Array.isArray(b.groups)) saveGroups_(ses, b.groups);
  var cx = ctx_(), mr = memberRooms_(cx, ses.email, ses.playerId), mute = muted_(ses.email);
  var em = ses.email.toLowerCase(), sum = {};
  tail_('Beskeder', TAIL).rows.forEach(function (r) {
    var room = String(r[2]); if (!mr[room] || bool_(r[7])) return;
    var s = sum[room] = sum[room] || { last: 0, n: 0, by: '', x: '', recent: [] };
    var t = ts_(r[1]); s.n++;
    if (t >= s.last) { s.last = t; s.by = String(r[4]); s.x = String(r[6]).slice(0, 80); }
    if (String(r[5]).toLowerCase() !== em) s.recent.push(t);
  });
  var own = memberRooms_(cx, ses.email, ses.playerId, true);
  var rooms = Object.keys(mr).map(function (id) {
    var s = sum[id] || { last: 0, n: 0, by: '', x: '', recent: [] };
    return { id: id, title: mr[id], last: s.last, n: s.n, by: s.by, x: s.x, recent: s.recent.slice(-30), muted: !!mute[id], extra: !own[id] };
  });
  var admin = roleIn_(cx, ses.email, ses.playerId).admin;
  return { ok: true, rooms: rooms, news: newsFor_(mr, admin), canNews: admin };
}

function messages_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var room = clean_(b.room, 60), cx = ctx_(), mr = memberRooms_(cx, ses.email, ses.playerId);
  if (!mr[room]) return { ok: false, error: 'Du er ikke med i ' + (/^g:/.test(room) ? 'træningsgruppen' : 'holdet') };
  // Forældres børn (fornavne) vises ved deres beskeder. En spiller der også er forælder får kun mærket i børnenes holds rum.
  var em = ses.email.toLowerCase(), kidsOf = {}, team = /^h:/.test(room) ? cx.teams[room.slice(2)] : null;
  cx.par.forEach(function (r) {
    var e = String(r[0]).toLowerCase(), pid0 = String(r[1]);
    if (!/^p:/.test(pid0) && !(team && team.p.indexOf(String(r[3])) >= 0)) return;
    (kidsOf[e] = kidsOf[e] || []).push(String(r[4]).split(' ')[0]);
  });
  var list = tail_('Beskeder', TAIL).rows.filter(function (r) { return String(r[2]) === room && !bool_(r[7]); }).map(function (r) {
    var pid = String(r[3]), se = String(r[5]).toLowerCase();
    return { id: String(r[0]), t: ts_(r[1]), p: pid, n: String(r[4]), x: String(r[6]), mine: se === em, k: kidsOf[se] && kidsOf[se].length ? kidsOf[se] : undefined };
  }).sort(function (a, b) { return a.t - b.t; }).slice(-150);
  return { ok: true, room: room, title: mr[room], messages: list, canMod: canModerate_(cx, ses, room), muted: !!muted_(em)[room] };
}

function post_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var room = clean_(b.room, 60), text = text_(b.text, MSG_MAX);
  if (!text) return { ok: false, error: 'Skriv en besked' };
  var cx = ctx_(), mr = memberRooms_(cx, ses.email, ses.playerId);
  if (!mr[room]) return { ok: false, error: 'Du er ikke med i ' + (/^g:/.test(room) ? 'træningsgruppen' : 'holdet') };
  var em = ses.email.toLowerCase();
  var msg = withLock_(function () {
    var minute = Date.now() - 60000;
    var recent = tail_('Beskeder', 200).rows.filter(function (r) { return String(r[5]).toLowerCase() === em && ts_(r[1]) > minute; }).length;
    if (recent >= MSG_PER_MIN) return null;
    var id = newId_('b'), now = new Date();
    sh_('Beskeder').appendRow([id, now, safe_(room), safe_(ses.playerId), safe_(ses.playerName), em, safe_(text), false]);
    return { id: id, t: now.getTime(), p: ses.playerId, n: ses.playerName, x: text, mine: true };
  });
  if (!msg) return { ok: false, error: 'Du skriver meget hurtigt — vent et øjeblik' };
  // Push til de andre i rummet (ikke afsenderen, ikke dem der har gjort rummet lydløst)
  try {
    var muted = {}; data_('Lydløs').forEach(function (r) { if (String(r[1]) === room) muted[String(r[0]).toLowerCase()] = 1; });
    var jobs = pushTargets_(cx, function (e, pid) { return e !== em && !muted[e] && !!memberRooms_(cx, e, pid, true)[room]; }).map(function (r) {
      return [new Date(), r.endpoint, r.p256dh, r.auth, clean_(ses.playerName.split(' ')[0] + ' · ' + mr[room], 80),
              clean_(text, 140), APP_URL + '#/snak/' + encodeURIComponent(room), 'r:' + room];
    });
    queuePush_(jobs);
  } catch (e) {}
  return { ok: true, message: msg };
}

function delMsg_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var id = clean_(b.id, 40), cx = ctx_();
  return withLock_(function () {
    var t = tail_('Beskeder', TAIL), em = ses.email.toLowerCase();
    for (var i = t.rows.length - 1; i >= 0; i--) {
      var r = t.rows[i];
      if (String(r[0]) !== id) continue;
      if (String(r[5]).toLowerCase() !== em && !canModerate_(cx, ses, String(r[2]))) return { ok: false, error: 'Du kan kun slette dine egne beskeder' };
      sh_('Beskeder').getRange(t.first + i, 8).setValue(true);
      return { ok: true };
    }
    return { ok: false, error: 'Beskeden findes ikke' };
  });
}

function mute_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var room = clean_(b.room, 60);
  return withLock_(function () {
    var sh = sh_('Lydløs'), rows = data_('Lydløs'), em = ses.email.toLowerCase();
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][0]).toLowerCase() === em && String(rows[i][1]) === room) sh.deleteRow(i + 2);
    if (b.on) sh.appendRow([em, safe_(room)]);
    return { ok: true, muted: !!b.on };
  });
}

// ---------- Nyheder (administrator) ----------
function newsSave_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var title = clean_(b.title, 100), text = text_(b.text, NEWS_MAX);
  if (!title) return { ok: false, error: 'Skriv en overskrift' };
  if (!text) return { ok: false, error: 'Skriv en tekst' };
  var cx = ctx_();
  var to = (b.to || []).map(function (x) { return clean_(x, 60); }).filter(function (x) {
    return x === '*' || (/^h:\d+$/.test(x) && cx.teams[x.slice(2)]) || (/^g:/.test(x) && TR_GROUPS.indexOf(x.slice(2)) >= 0);
  });
  if (!to.length) return { ok: false, error: 'Vælg hvem nyheden er til' };
  if (to.indexOf('*') >= 0) to = ['*'];
  var id = newId_('n');
  withLock_(function () { sh_('Nyheder').appendRow([id, new Date(), safe_(title), safe_(text), to.join(','), safe_(ses.playerName), false]); });
  var pushed = 0;
  if (b.push) {
    var jobs = pushTargets_(cx, function (e, pid) {
      if (to[0] === '*') return true;
      var mr = memberRooms_(cx, e, pid, true);
      return to.some(function (x) { return !!mr[x]; });
    }).map(function (r) {
      return [new Date(), r.endpoint, r.p256dh, r.auth, clean_('HØBK · ' + title, 80), clean_(text, 140), APP_URL + '#/nyhed/' + id, 'n:' + id];
    });
    pushed = jobs.length; queuePush_(jobs);
  }
  return { ok: true, id: id, pushed: pushed };
}
function newsDel_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var id = clean_(b.id, 40);
  return withLock_(function () {
    var rows = data_('Nyheder');
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) { sh_('Nyheder').getRange(i + 2, 7).setValue(true); return { ok: true }; }
    return { ok: false, error: 'Nyheden findes ikke' };
  });
}
function newsList_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  return { ok: true, news: newsRows_().slice(0, 60) };
}

// ---------- Aktiviteter (administrator planlægger; spillere og forældre tager opgaver) ----------
// start/slut gemmes som lokal tid "YYYY-MM-DDTHH:MM" (dansk tid) — sammenlignes som tekst.
// til = '*' eller rum (h:<holdId>, g:<gruppe>) — samme modtagere som nyheder.
function dtOk_(x) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x); }
function localNow_() { return Utilities.formatDate(new Date(), 'Europe/Copenhagen', "yyyy-MM-dd'T'HH:mm"); }
function actRows_() {
  return data_('Aktiviteter').map(function (r, i) {
    var tasks = []; try { tasks = JSON.parse(r[10] || '[]'); } catch (e) { tasks = []; }
    return { row: i + 2, id: String(r[0]), name: String(r[2]), desc: String(r[3]), start: String(r[4]), end: String(r[5]),
             cal: bool_(r[6]), to: String(r[7]).split(',').map(function (x) { return x.trim(); }).filter(String), by: String(r[8]), del: bool_(r[9]), tasks: tasks };
  }).filter(function (a) { return a.id && !a.del; });
}
function signups_() {   // seneste svar pr. (aktivitet, opgave, e-mail)
  var last = {};
  data_('Opgavetilmeldinger').forEach(function (r) {
    var k = r[1] + '|' + r[2] + '|' + String(r[3]).toLowerCase();
    if (!last[k] || ts_(last[k][0]) <= ts_(r[0])) last[k] = r;
  });
  var out = {};
  Object.keys(last).forEach(function (k) {
    var r = last[k]; if (String(r[6]) !== 'ja') return;
    var key = r[1] + '|' + r[2];
    (out[key] = out[key] || []).push({ email: String(r[3]).toLowerCase(), p: String(r[4]), n: String(r[5]), t: ts_(r[0]) });
  });
  Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a.t - b.t; }); });
  return out;
}
function visible_(a, rooms, admin) { return admin || a.to.indexOf('*') >= 0 || a.to.some(function (x) { return !!rooms[x]; }); }
function actOut_(a, sign, em, names) {
  return { id: a.id, name: a.name, desc: a.desc, start: a.start, end: a.end, cal: a.cal, to: a.to, by: a.by,
           tasks: a.tasks.map(function (t) {
             var list = sign[a.id + '|' + t.id] || [];
             return { id: t.id, title: t.title, need: t.need, from: t.from || '', to: t.to || '', n: list.length, mine: !!em && list.some(function (x) { return x.email === em; }),
                      who: names ? list.map(function (x) { return { p: x.p, n: x.n }; }) : undefined };
           }) };
}
function acts_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var cx = ctx_(), admin = roleIn_(cx, ses.email, ses.playerId).admin, mr = memberRooms_(cx, ses.email, ses.playerId);
  var since = Utilities.formatDate(new Date(Date.now() - 60 * 86400000), 'Europe/Copenhagen', "yyyy-MM-dd'T'HH:mm");
  var sign = signups_(), em = ses.email.toLowerCase();
  var list = actRows_().filter(function (a) { return a.end >= since && visible_(a, mr, admin); })
    .sort(function (x, y) { return x.start < y.start ? -1 : 1; }).map(function (a) { return actOut_(a, sign, em, true); });
  return { ok: true, acts: list, canEdit: admin };
}
function actsPublic_() {   // til alle: uden navne på dem der har taget opgaver
  var now = localNow_(), sign = signups_();
  return { ok: true, acts: actRows_().filter(function (a) { return a.end >= now && a.to.indexOf('*') >= 0; })
    .sort(function (x, y) { return x.start < y.start ? -1 : 1; }).map(function (a) { return actOut_(a, sign, '', false); }) };
}
function actSave_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var name = clean_(b.name, 100), desc = text_(b.desc, 3000), start = clean_(b.start, 16), end = clean_(b.end, 16) || start;
  if (!name) return { ok: false, error: 'Skriv et navn' };
  if (!dtOk_(start) || !dtOk_(end)) return { ok: false, error: 'Vælg start og slut' };
  if (end < start) return { ok: false, error: 'Slut er før start' };
  var cx = ctx_();
  var to = (b.to || []).map(function (x) { return clean_(x, 60); }).filter(function (x) {
    return x === '*' || (/^h:\d+$/.test(x) && cx.teams[x.slice(2)]) || (/^g:/.test(x) && TR_GROUPS.indexOf(x.slice(2)) >= 0);
  });
  if (!to.length) return { ok: false, error: 'Vælg hvem aktiviteten er for' };
  if (to.indexOf('*') >= 0) to = ['*'];
  var tasks = (b.tasks || []).slice(0, 40).map(function (t) {
    var from = dtOk_(String(t.from || '')) ? String(t.from) : '', to = dtOk_(String(t.to || '')) ? String(t.to) : '';
    if (from && to && to < from) to = from;
    return { id: /^o[0-9a-z]+$/.test(String(t.id || '')) ? String(t.id) : newId_('o'), title: clean_(t.title, 80), need: Math.max(0, Math.min(99, parseInt(t.need, 10) || 0)), from: from, to: to };
  }).filter(function (t) { return t.title; });
  var badTime = tasks.filter(function (t) { return t.from && (t.from < start.slice(0, 10) + 'T00:00' || t.from > end); })[0];
  if (badTime) return { ok: false, error: 'Tiden for "' + badTime.title + '" ligger uden for aktiviteten' };
  var id = /^a[0-9a-z]+$/.test(String(b.id || '')) ? String(b.id) : '';
  var isNew = !id;
  withLock_(function () {
    var sh = sh_('Aktiviteter');
    if (id) {
      var cur = actRows_().filter(function (a) { return a.id === id; })[0];
      if (!cur) { id = ''; isNew = true; }
      else sh.getRange(cur.row, 3, 1, 9).setValues([[safe_(name), safe_(desc), start, end, !!b.cal, to.join(','), safe_(ses.playerName), false, JSON.stringify(tasks)]]);
    }
    if (!id) { id = newId_('a'); sh.appendRow([id, new Date(), safe_(name), safe_(desc), start, end, !!b.cal, to.join(','), safe_(ses.playerName), false, JSON.stringify(tasks)]); }
  });
  var pushed = 0;
  if (b.push) {
    var jobs = pushTargets_(cx, function (e, pid) {
      if (to[0] === '*') return true;
      var mr = memberRooms_(cx, e, pid, true);
      return to.some(function (x) { return !!mr[x]; });
    }).map(function (r) {
      return [new Date(), r.endpoint, r.p256dh, r.auth, clean_((isNew ? 'Ny aktivitet · ' : 'Aktivitet ændret · ') + name, 80),
              clean_(start.replace('T', ' kl. ') + (tasks.length ? ' — tag en opgave i appen' : ''), 140), APP_URL + '#/aktivitet/' + id, 'a:' + id];
    });
    pushed = jobs.length; queuePush_(jobs);
  }
  return { ok: true, id: id, pushed: pushed };
}
function actDel_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var id = clean_(b.id, 40);
  return withLock_(function () {
    var cur = actRows_().filter(function (a) { return a.id === id; })[0];
    if (!cur) return { ok: false, error: 'Aktiviteten findes ikke' };
    sh_('Aktiviteter').getRange(cur.row, 10).setValue(true);
    return { ok: true };
  });
}
function taskSign_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var aid = clean_(b.act, 40), tid = clean_(b.task, 40);
  var cx = ctx_(), admin = roleIn_(cx, ses.email, ses.playerId).admin;
  var a = actRows_().filter(function (x) { return x.id === aid; })[0];
  if (!a || !visible_(a, memberRooms_(cx, ses.email, ses.playerId), admin)) return { ok: false, error: 'Aktiviteten findes ikke' };
  var t = a.tasks.filter(function (x) { return x.id === tid; })[0];
  if (!t) return { ok: false, error: 'Opgaven findes ikke' };
  if (a.end < localNow_()) return { ok: false, error: 'Aktiviteten er slut' };
  var em = ses.email.toLowerCase();
  return withLock_(function () {
    var list = signups_()[aid + '|' + tid] || [], has = list.some(function (x) { return x.email === em; });
    if (b.on && !has && t.need && list.length >= t.need) return { ok: false, error: 'Opgaven er fuld' };
    if (!!b.on !== has) sh_('Opgavetilmeldinger').appendRow([new Date(), aid, tid, em, safe_(ses.playerId), safe_(ses.playerName), b.on ? 'ja' : 'nej']);
    var now = signups_()[aid + '|' + tid] || [];
    return { ok: true, task: { id: t.id, title: t.title, need: t.need, from: t.from || '', to: t.to || '', n: now.length, mine: !!b.on, who: now.map(function (x) { return { p: x.p, n: x.n }; }) } };
  });
}

// ---------- Push-kø ----------
// Scriptet kan ikke selv underskrive web-push. Beskeder lægges i fanen PushKø; GitHub-workflowet push.yml henter
// køen (?action=pushqueue), tømmer den og sender. Workflowet startes med det samme (højst hvert minut) og af tick().
function pushTargets_(cx, want) {
  var out = [], seen = {};
  data_('Push').forEach(function (r) {
    var em = String(r[0]).toLowerCase(), ep = String(r[2]);
    if (!ep || seen[ep]) return; seen[ep] = 1;
    if (want(em, String(r[1]))) out.push({ endpoint: ep, p256dh: String(r[3]), auth: String(r[4]) });
  });
  return out;
}
function queuePush_(rows) {
  if (!rows || !rows.length) return;
  withLock_(function () {
    var sh = sh_('PushKø');
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEETS['PushKø'].length).setValues(rows);
  });
  var pr = PropertiesService.getScriptProperties();
  pr.setProperty('PUSH_PENDING', '1');
  if (Date.now() - Number(pr.getProperty('PUSH_DISPATCHED') || 0) > 60000) {
    pr.setProperty('PUSH_DISPATCHED', String(Date.now()));
    try { ghDispatch_('push.yml'); } catch (e) {}
  }
}
function pushQueue_(key) {
  var k = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!k || key !== k) return { ok: false, error: 'Forkert nøgle' };
  return withLock_(function () {
    var sh = sh_('PushKø'), rows = data_('PushKø'), dayAgo = Date.now() - 86400000;
    if (rows.length) sh.deleteRows(2, rows.length);
    PropertiesService.getScriptProperties().setProperty('PUSH_PENDING', '0');
    return { ok: true, push: rows.filter(function (r) { return ts_(r[0]) > dayAgo; }).slice(0, 1000).map(function (r) {
      return { endpoint: String(r[1]), keys: { p256dh: String(r[2]), auth: String(r[3]) }, title: String(r[4]), body: String(r[5]), url: String(r[6]), tag: String(r[7]) };
    }) };
  });
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
      case 'children': return json_(children_(b));
      case 'acts': return json_(acts_(b));
      case 'actSave': return json_(actSave_(b));
      case 'actDel': return json_(actDel_(b));
      case 'taskSign': return json_(taskSign_(b));
      case 'rooms': return json_(rooms_(b));
      case 'messages': return json_(messages_(b));
      case 'post': return json_(post_(b));
      case 'delMsg': return json_(delMsg_(b));
      case 'mute': return json_(mute_(b));
      case 'newsSave': return json_(newsSave_(b));
      case 'newsDel': return json_(newsDel_(b));
      case 'newsList': return json_(newsList_(b));
      case 'me': var s = session_(b.token); return json_(s ? { ok: true, player: { id: s.playerId, name: s.playerName, email: s.email }, role: role_(s.email, s.playerId), follows: follows_(s.email), settings: settings_(s.email), kids: kids_(s.email) } : { ok: false, error: 'login' });
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
  if (action === 'version') {
    var pr = PropertiesService.getScriptProperties();
    return json_({ ok: true, version: SCRIPT_VERSION, scheduler: { token: !!pr.getProperty('GH_TOKEN'), triggers: ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'tick'; }).length,
                   lastTick: pr.getProperty('LAST_TICK') || '', last: pr.getProperty('LAST_DISPATCH') || '' } });
  }
  if (action === 'news') {   // offentlige nyheder (til alle) — til appen før man logger ind
    return json_({ ok: true, news: newsFor_({}, false).filter(function (n) { return n.to.indexOf('*') >= 0; }).slice(0, 10) });
  }
  if (action === 'pushqueue') return json_(pushQueue_(e.parameter.key));
  if (action === 'acts') return json_(actsPublic_());
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

// ---------- Fast tidsplan for GitHub-kørslerne ----------
// GitHubs egen tidsplan forsinker/springer kørsler over på gratis repos. Googles tidsudløser er pålidelig,
// så scriptet starter kørslerne selv. Opsætning (én gang):
//  1. Lav en GitHub-nøgle (fine-grained token) med adgang til repoet Hoebk og tilladelsen Actions: Read and write.
//  2. Projektindstillinger (tandhjulet) → Scriptegenskaber → Tilføj: GH_TOKEN = nøglen.
//  3. Vælg funktionen installTriggers øverst → Kør → godkend.
var GH_REPO = 'christoffergroenfeldt-cyber/Hoebk';

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(15).create();
  Logger.log('Tidsplan installeret: tick() hvert 15. minut. GitHub-nøgle sat: ' + !!PropertiesService.getScriptProperties().getProperty('GH_TOKEN'));
  tick();
}

function ghDispatch_(workflow) {
  var tok = PropertiesService.getScriptProperties().getProperty('GH_TOKEN');
  if (!tok) return 'ingen GH_TOKEN';
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/actions/workflows/' + workflow + '/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main' })
  });
  return workflow + ':' + r.getResponseCode();   // 204 = startet
}

// Hvert 15. minut: tilmeldinger altid; kampdags-opdatering hver halve time kl. 9–22 (den stopper selv på dage
// uden kampe); fuld opdatering én gang om morgenen og én gang om aftenen.
function tick() {
  var pr = PropertiesService.getScriptProperties(), now = new Date();
  var h = Number(Utilities.formatDate(now, 'Europe/Copenhagen', 'H')), day = Utilities.formatDate(now, 'Europe/Copenhagen', 'yyyy-MM-dd');
  var res = [ghDispatch_('tilmeldinger.yml')];
  var odd = pr.getProperty('TICK_ODD') === '1';
  pr.setProperty('TICK_ODD', odd ? '0' : '1');
  if (h >= 9 && h <= 22 && !odd) res.push(ghDispatch_('live.yml'));
  if (h >= 6 && pr.getProperty('FULL_AM') !== day) { pr.setProperty('FULL_AM', day); res.push(ghDispatch_('holdkampe.yml')); }
  else if (h >= 21 && pr.getProperty('FULL_PM') !== day) { pr.setProperty('FULL_PM', day); res.push(ghDispatch_('holdkampe.yml')); }
  if (pr.getProperty('PUSH_PENDING') === '1') res.push(ghDispatch_('push.yml'));   // push der ikke blev sendt med det samme
  pr.setProperty('LAST_TICK', now.toISOString());
  pr.setProperty('LAST_DISPATCH', res.join(' '));
}

// --- slut på filen (denne linje må gerne mangle ved kopiering) ---
