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
 *  register {token, type, eventId, status, label}→ gemmer svar for den indloggede spiller
 *  lineup   {token, eventId, team, status, squad[], games[], note} → holdopstilling (kun holdledere, se fanen Ledere)
 *  leaders / setLeader {token, email, name, teams[]} → administrator (ADMIN_PLAYER_IDS) udnævner holdledere
 *  logout   {token}
 *  GET ?action=status          → seneste svar pr. (begivenhed, spiller) — offentlig, uden e-mails
 *  GET ?action=all&key=NØGLE   → alle svar (til GitHub-synkronisering) — uden e-mails
 */

var CLUB = 'Hørsholm Badminton Klub';
var TYPES = { match: ['ja', 'nej', 'maaske'], training: ['ja', 'nej'] };
var SHEETS = {
  Tilmeldinger: ['tidspunkt', 'type', 'eventId', 'playerId', 'playerName', 'status', 'label'],
  Spillere: ['playerId', 'playerName', 'email', 'bekræftet', 'sidst set'],
  Koder: ['tidspunkt', 'email', 'kodeHash', 'playerId', 'playerName', 'forsøg', 'brugt'],
  Sessioner: ['tokenHash', 'playerId', 'playerName', 'email', 'oprettet', 'sidst brugt', 'aktiv'],
  Ledere: ['email', 'navn', 'hold'],
  Opstillinger: ['tidspunkt', 'eventId', 'hold', 'status', 'gemtAf', 'data']
};
// Administrator(er): må udnævne holdledere i appen. Badmintonplayer-spiller-id'er.
// Den FØRSTE e-mail der bekræfter navnet (fanen Spillere) ejer rollen — en anden e-mail med samme navn bliver ikke admin.
var ADMIN_PLAYER_IDS = ['12813'];   // Anders Vedsted Nørrelund
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
      return { ok: true, token: token, player: { id: pid, name: pname, email: email }, role: role_(email, pid) };
    }
    return { ok: false, error: 'Koden er udløbet eller forkert — bed om en ny' };
  });
}

// Holdledere: fanen "Ledere" — én række pr. leder. hold = holdlabels adskilt af komma
// (fx "U15 B, U13 B") eller * for alle hold. Matcher på den e-mail lederen logger ind med.
function isAdmin_(email, playerId) {
  var em = String(email || '').toLowerCase().trim(), pid = String(playerId || '');
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
  return { ok: true, leaders: leaders, emails: emails };
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
      case 'me': var s = session_(b.token); return json_(s ? { ok: true, player: { id: s.playerId, name: s.playerName, email: s.email }, role: role_(s.email, s.playerId) } : { ok: false, error: 'login' });
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
  var rows = data_('Tilmeldinger');
  if (action === 'all') {
    var key = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!key || e.parameter.key !== key) return json_({ ok: false, error: 'Forkert nøgle' });
    return json_({ ok: true, lineups: lineups_(), rows: rows.map(function (r) {
      return { ts: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), type: r[1], eventId: String(r[2]),
               playerId: String(r[3]), playerName: String(r[4]), status: r[5], label: String(r[6]) };
    }) });
  }
  var latest = {};
  rows.forEach(function (r) {
    var k = r[2] + '|' + r[3], ts = r[0] instanceof Date ? r[0].getTime() : 0;
    if (!latest[k] || latest[k].t <= ts) latest[k] = { e: String(r[2]), p: String(r[3]), n: String(r[4]), s: r[5], t: ts };
  });
  return json_({ ok: true, updated: new Date().toISOString(), status: Object.keys(latest).map(function (k) { return latest[k]; }), lineups: lineups_() });
}

// --- slut på filen (denne linje må gerne mangle ved kopiering) ---
