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
 *  register {token, type, eventId, status, label, player?}→ gemmer svar for den indloggede spiller (status 'ryd' fjerner svaret);
 *           player = et af ens børns spiller-id → forælderen svarer på barnets vegne (gemmes under barnets navn)
 *  lineup   {token, eventId, team, status, squad[], games[], note} → holdopstilling (kun holdledere, se fanen Ledere)
 *  leaders / setLeader {token, email, name, teams[]} → administrator (ADMIN_PLAYER_IDS) udnævner holdledere
 *  users    {token}                              → administratorer: alle registrerede brugere (navn, e-mail, rolle, børn, sidst aktiv)
 *  toParent {token, email, childId?}            → administrator: en forælder der har registreret sig som sit barn bliver forælder ("Carl forælder")
 *  rename   {token, name}                        → forældre kan ændre deres eget navn (spillere hedder som på badmintonplayer.dk)
 *  setAdmin {token, email, name, on}           → faste administratorer udnævner/fjerner administratorer (fanen Administratorer)
 *  follow   {token, tid, title, on}              → følg/stop med at følge en turnering (fanen Følger)
 *  notify   {key, items[{ids[], title, lines[], url}]} → GitHub sender nyt om turneringer; mail til dem der følger
 *           svarer med push-jobs, som GitHub sender videre som push-notifikationer (kræver VAPID-nøglen)
 *  push     {token, sub{endpoint, keys{p256dh, auth}}, on, device} → tilmeld/afmeld push på en telefon
 *  prefs    {token, mail}                        → mail ved nyt til/fra (push påvirkes ikke)
 *  pushGone {key, endpoints[]}                   → GitHub melder døde push-adresser, de slettes
 *  GET ?action=follows&key=NØGLE → hvilke turneringer der følges (kun id'er, ingen e-mails)
 *  logout   {token}
 *  request  for forældre: playerId "p:<navn>" + children[{id, name}] · children {token, children[]} → ret sine børn
 *  rides {token, event} · rideSet {token, event, mode, seats, pickup, time, note, player?} · rideTake {token, event, driver, player?} → samkørsel
 *  deviceCode {token} → engangskode til en anden enhed · deviceLogin {code} → login med den
 *  acts {token} / GET ?action=acts → aktiviteter · actSave {…, link} / actDel (administrator) · taskSign {token, act, task, on}
 *  groupList {token} → holdlister man må ændre · groupMember {token, group, playerId, name, on} eller {token, group, players[{id, name}], on} → holdledere sætter spillere på hold/træningsgrupper
 *  Admin-chat: rummet x:admin — kun administratorer. GET ?action=ideas&key=IDEAS_KEY → beskederne (kun læsning, uden e-mails)
 *  rooms    {token, groups[]}                    → mine snak-rum (hold + træningsgrupper) med seneste aktivitet + nyheder til mig
 *  messages {token, room}                        → beskeder i et rum (kun medlemmer) · post {token, room, text} · delMsg {token, id}
 *  mute     {token, room, on}                    → ingen push for et rum
 *  newsSave {token, title, text, to[], push, img?} (img = data:image/jpeg;base64,… → gemmes i Drive-mappen "HØBK nyhedsbilleder") / newsDel {token, id} / newsList {token} → administrator skriver nyheder
 *  GET ?action=news            → offentlige nyheder (til alle) · GET ?action=pushqueue&key=NØGLE → push-køen (tømmes)
 *  GET ?action=status          → seneste svar pr. (begivenhed, spiller) — offentlig, uden e-mails
 *  GET ?action=all&key=NØGLE   → alle svar (til GitHub-synkronisering) — uden e-mails
 */

var SCRIPT_VERSION = '2026-11-06.1';   // vises af ?action=version — så GitHub kan se om den nye version er implementeret
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
  Nyheder: ['id', 'tidspunkt', 'titel', 'tekst', 'til', 'af', 'slettet', 'billede'],
  Grupper: ['email', 'playerId', 'grupper'],
  'Lydløs': ['email', 'rum'],
  'Forældre': ['email', 'forælderId', 'forælderNavn', 'barnId', 'barnNavn', 'tidspunkt'],
  Aktiviteter: ['id', 'oprettet', 'navn', 'beskrivelse', 'start', 'slut', 'kalender', 'til', 'af', 'slettet', 'opgaver', 'søgerHjælp', 'link'],
  Opgavetilmeldinger: ['tidspunkt', 'aktivitetId', 'opgaveId', 'email', 'playerId', 'navn', 'status'],
  Administratorer: ['email', 'navn', 'udnævntAf', 'tidspunkt'],
  // Forberedt til godkendelse (bruges først når APPROVAL slås til — se docs/GODKENDELSE.md)
  Medlemmer: ['email', 'navn', 'medlemsnr', 'importeret'],
  Godkendelser: ['tidspunkt', 'email', 'playerId', 'navn', 'rolle', 'status', 'note', 'behandletAf', 'behandlet'],
  Holdmedlemmer: ['playerId', 'navn', 'gruppe', 'tilføjetAf', 'tidspunkt'],
  'PushKø': ['tidspunkt', 'endpoint', 'p256dh', 'auth', 'titel', 'tekst', 'url', 'tag'],
  // Samkørsel til holdkampe og turneringer: én række pr. person pr. kamp/turnering
  'Kørsel': ['tidspunkt', 'begivenhed', 'titel', 'playerId', 'navn', 'email', 'valg', 'pladser', 'opsamling', 'afgang', 'chauffør', 'note'],
  // Hjælp og feedback: brugernes henvendelser til administratorerne (status: ny | besvaret | lukket)
  Feedback: ['id', 'tidspunkt', 'email', 'playerId', 'navn', 'type', 'tekst', 'side', 'enhed', 'status', 'svar', 'svaretAf', 'svaret', 'adminChat']
};
// Administrator(er): må udnævne holdledere i appen. Badmintonplayer-spiller-id'er.
// Den FØRSTE e-mail der bekræfter navnet (fanen Spillere) ejer rollen — en anden e-mail med samme navn bliver ikke admin.
var ADMIN_PLAYER_IDS = ['12813'];   // Anders Vedsted Nørrelund
// Administratorer ud fra login-e-mail (gemt som SHA-256 af e-mailen med små bogstaver, så adressen ikke står i koden).
// Ny: kør  printf '%s' 'navn@eksempel.dk' | sha256sum  og tilføj tallet.
var ADMIN_EMAIL_SHA256 = [];   // flere faste administratorer ud fra e-mail (SHA-256)
// Hovedadministrator: appens skaber og ansvarlige (Christoffer). Står kun her i koden — kan ikke fjernes eller ændres
// fra appen, vises ikke i lister over administratorer/holdledere og kan ikke tilføjes til dem.
var SUPER_ADMIN_SHA256 = ['61b300daa9a1d0d7ce2848c73b1207e5c2c98dd5a93a2b66884f460ef587b90f'];   // Christoffer
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
  var ideas = props.getProperty('IDEAS_KEY');   // kun til at læse admin-chatten (fx når Claude skal se forslagene)
  if (!ideas) { ideas = Utilities.getUuid().replace(/-/g, '').slice(0, 20); props.setProperty('IDEAS_KEY', ideas); }
  Logger.log('Læsenøgle til admin-chatten (IDEAS_KEY): ' + ideas);
  // Fjern standardfanen "Ark1"/"Sheet1" hvis arket lige er oprettet og fanen er tom
  ['Ark1', 'Sheet1'].forEach(function (n) { var x = ss.getSheetByName(n); if (x && x.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(x); });
  fixParentNames_();
  Logger.log('Mappe til nyhedsbilleder: ' + imgFolder_().getUrl());   // beder også om adgang til Google Drive første gang
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
      return startSession_(email, String(r[3]), String(r[4]), r[7]);
    }
    return { ok: false, error: 'Koden er udløbet eller forkert — bed om en ny' };
  });
}
function startSession_(email, pid, pname, kidsJson) {   // kaldes inde i låsen
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  sh_('Sessioner').appendRow([hash_('t:' + token), safe_(pid), safe_(pname), email, new Date(), new Date(), true]);
  var sp = sh_('Spillere'), known = data_('Spillere'), found = false;
  for (var j = 0; j < known.length; j++) {
    if (String(known[j][0]) === pid && String(known[j][2]) === email) { sp.getRange(j + 2, 5).setValue(new Date()); found = true; }
  }
  if (!found) sp.appendRow([safe_(pid), safe_(pname), email, new Date(), new Date()]);
  var kids = []; try { kids = kidsJson ? JSON.parse(kidsJson) : []; } catch (e) { kids = []; }
  if (kids.length) setKids_(email, pid, pname, kids, true);
  var approval = APPROVAL.enabled ? requestApprovalLocked_(email, pid, pname) : '';
  return { ok: true, token: token, player: { id: pid, name: pname, email: email }, role: role_(email, pid), follows: follows_(email), kids: kids_(email), approval: approval };
}

// ---------- Log ind på en anden enhed ----------
// En logget-ind bruger laver en engangskode (8 tegn, gælder DEVICE_MINUTES) under Min side og skriver den på den nye enhed.
// Gemmes i fanen Koder med e-mailen "enhed:<email>" så den ikke blandes med e-mail-koderne.
var DEVICE_MINUTES = 10, DEVICE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function deviceCode_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var em = ses.email.toLowerCase(), code = '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  for (var i = 0; i < 8; i++) code += DEVICE_ALPHA.charAt((bytes[i] & 0xff) % DEVICE_ALPHA.length);
  withLock_(function () {
    var s = sh_('Koder'), rows = data_('Koder');
    rows.forEach(function (r, i) { if (r[1] === 'enhed:' + em && r[6] !== true) s.getRange(i + 2, 7).setValue(true); });   // kun den nyeste kode gælder
    s.appendRow([new Date(), 'enhed:' + em, hash_('d:' + code), safe_(ses.playerId), safe_(ses.playerName), 0, false, '']);
  });
  return { ok: true, code: code.slice(0, 4) + '-' + code.slice(4), minutes: DEVICE_MINUTES };
}
function deviceLogin_(b) {
  var code = clean_(b.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) return { ok: false, error: 'Koden har 8 tegn' };
  var cache = CacheService.getScriptCache(), fails = Number(cache.get('devfail') || 0);
  if (fails >= 30) return { ok: false, error: 'For mange forkerte forsøg — vent 10 minutter' };
  return withLock_(function () {
    var s = sh_('Koder'), rows = data_('Koder'), limit = new Date(Date.now() - DEVICE_MINUTES * 60000), h = hash_('d:' + code);
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      if (String(r[1]).indexOf('enhed:') !== 0 || r[6] === true || new Date(r[0]) < limit || r[2] !== h) continue;
      s.getRange(i + 2, 7).setValue(true);
      var email = String(r[1]).slice(6);
      return startSession_(email, String(r[3]), String(r[4]), '');
    }
    cache.put('devfail', String(fails + 1), 600);
    return { ok: false, error: 'Koden er forkert eller udløbet — lav en ny på din anden enhed' };
  });
}

// Holdledere: fanen "Ledere" — én række pr. leder. hold = holdlabels adskilt af komma
// (fx "U15 B, U13 B") eller * for alle hold. Matcher på den e-mail lederen logger ind med.
function sha256hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
// Faste administratorer (står i koden ovenfor) — de eneste der kan udnævne flere administratorer
function isSuper_(email) {
  var em = String(email || '').toLowerCase().trim();
  return !!em && SUPER_ADMIN_SHA256.indexOf(sha256hex_(em)) >= 0;
}
function isOwner_(email, playerId) {
  if (isSuper_(email)) return true;
  var em = String(email || '').toLowerCase().trim(), pid = String(playerId || '');
  if (em && ADMIN_EMAIL_SHA256.indexOf(sha256hex_(em)) >= 0) return true;
  if (!em || ADMIN_PLAYER_IDS.indexOf(pid) < 0) return false;
  var first = data_('Spillere').filter(function (r) { return String(r[0]) === pid; })
    .sort(function (a, b) { return new Date(a[3]) - new Date(b[3]); })[0];
  return !!first && String(first[2]).toLowerCase().trim() === em;
}
// Administrator = fast administrator eller udnævnt i fanen Administratorer (gælder den e-mail man logger ind med)
function isAdmin_(email, playerId) {
  if (isOwner_(email, playerId)) return true;
  var em = String(email || '').toLowerCase().trim();
  return !!em && data_('Administratorer').some(function (r) { return String(r[0]).toLowerCase().trim() === em; });
}

function role_(email, playerId) {
  var em = String(email || '').toLowerCase().trim();
  if (!em) return { leader: false, teams: [] };
  if (isAdmin_(em, playerId)) return { leader: true, all: true, admin: true, owner: isOwner_(em, playerId), super: isSuper_(em), teams: [] };
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
  var leaders = data_('Ledere').filter(function (r) { return !isSuper_(r[0]); }).map(function (r) {
    return { email: String(r[0]), name: String(r[1]), teams: String(r[2]).split(',').map(function (t) { return t.trim(); }).filter(String) };
  }).filter(function (l) { return l.email; });
  var emails = {};   // spiller-id → bekræftede e-mails (kun til administrator)
  data_('Spillere').forEach(function (r) { var id = String(r[0]); (emails[id] = emails[id] || []); if (emails[id].indexOf(String(r[2])) < 0) emails[id].push(String(r[2])); });
  var admins = data_('Administratorer').filter(function (r) { return String(r[0]) && !isSuper_(r[0]); }).map(function (r) { return { email: String(r[0]), name: String(r[1]), by: String(r[2]) }; });
  Object.keys(emails).forEach(function (id) { emails[id] = emails[id].filter(function (e) { return !isSuper_(e); }); });   // hovedadministratorens e-mail vises ikke
  return { ok: true, leaders: leaders, emails: emails, stats: stats_(), admins: admins, owner: isOwner_(ses.email, ses.playerId), super: isSuper_(ses.email) };
}

function setLeader_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var email = clean_(b.email, 120).toLowerCase();
  if (!validEmail_(email)) return { ok: false, error: 'Ugyldig e-mail' };
  if (isSuper_(email)) return { ok: false, error: 'Det er hovedadministratoren — leder for alle hold i forvejen' };
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

function setAdmin_(b) {
  var ses = session_(b.token);
  if (!ses || !isOwner_(ses.email, ses.playerId)) return { ok: false, error: 'Kun de faste administratorer kan udnævne administratorer' };
  var email = clean_(b.email, 120).toLowerCase();
  if (!validEmail_(email)) return { ok: false, error: 'Ugyldig e-mail' };
  if (email === ses.email.toLowerCase()) return { ok: false, error: 'Du er allerede fast administrator' };
  if (isSuper_(email)) return { ok: false, error: 'Det er hovedadministratoren — den rolle kan ikke ændres i appen' };
  return withLock_(function () {
    var sh = sh_('Administratorer'), rows = data_('Administratorer');
    for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][0]).toLowerCase().trim() === email) sh.deleteRow(i + 2);
    if (b.on) sh.appendRow([email, safe_(clean_(b.name, 80)), safe_(ses.playerName), new Date()]);
    return { ok: true };
  });
}

// Alle der har bekræftet en e-mail i appen — kun til administratorer (hovedadministratoren vises kun for sig selv)
function users_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var meSuper = isSuper_(ses.email), cx = ctx_(), by = {};
  data_('Spillere').forEach(function (r) {
    var em = String(r[2]).toLowerCase().trim(); if (!em) return;
    if (isSuper_(em) && !meSuper) return;
    var u = by[em] = by[em] || { email: em, profiles: [], first: 0, seen: 0, active: 0, push: 0, kids: [] };
    var id = String(r[0]), nm = String(r[1]);
    if (!u.profiles.some(function (p) { return p.id === id; })) u.profiles.push({ id: id, name: nm });
    var f = ts_(r[3]); if (f && (!u.first || f < u.first)) u.first = f;
    var l = ts_(r[4]); if (l > u.seen) u.seen = l;
  });
  data_('Sessioner').forEach(function (r) { var u = by[String(r[3]).toLowerCase()]; if (!u) return; var t = ts_(r[5]); if (t > u.active) u.active = t; });
  data_('Push').forEach(function (r) { var u = by[String(r[0]).toLowerCase()]; if (u) u.push++; });
  cx.par.forEach(function (r) { var u = by[String(r[0]).toLowerCase()]; if (u) u.kids.push({ id: String(r[3]), name: String(r[4]) }); });
  var users = Object.keys(by).map(function (em) {
    var u = by[em], p = u.profiles[u.profiles.length - 1], role = roleIn_(cx, em, p.id);
    return { email: em, name: p.name, id: p.id, profiles: u.profiles, parent: /^p:/.test(p.id) || u.kids.length > 0, kids: u.kids,
             admin: role.admin, superAdmin: isSuper_(em), leader: role.all || role.teams.length > 0, teams: role.teams, first: u.first, active: Math.max(u.active, u.seen), push: u.push };
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'da'); });
  return { ok: true, users: users };
}

// Skift playerId/navn for en e-mail i alle faner der gemmer det (aktive sessioner følger med, så ingen skal logge ind igen)
function changeIdentity_(email, newId, newName) {
  var em = String(email || '').toLowerCase().trim();
  var upd = function (tab, emailCol, idCol, nameCol) {
    var sh = sh_(tab), rows = data_(tab);
    rows.forEach(function (r, i) {
      if (String(r[emailCol]).toLowerCase().trim() !== em) return;
      if (idCol >= 0) sh.getRange(i + 2, idCol + 1).setValue(safe_(newId));
      if (nameCol >= 0) sh.getRange(i + 2, nameCol + 1).setValue(safe_(newName));
    });
  };
  upd('Spillere', 2, 0, 1); upd('Sessioner', 3, 1, 2); upd('Følger', 0, 1, 2); upd('Push', 0, 1, -1); upd('Forældre', 0, 1, 2); upd('Grupper', 0, 1, -1);
}
// Engangsrettelse: forældre oprettet som "X forældre" (version 2026-11-01.8) hedder "X forælder" — kun hvis de ikke selv har ændret navnet
function fixParentNames_() {
  var fixed = 0, done = {};
  data_('Spillere').forEach(function (r) {
    var id = String(r[0]), nm = String(r[1]), em = String(r[2]).toLowerCase();
    if (/^p:/.test(id) && / forældre$/.test(nm) && !done[em]) { done[em] = 1; changeIdentity_(em, id, nm.replace(/ forældre$/, ' forælder')); fixed++; }
  });
  if (fixed) Logger.log('Rettet ' + fixed + ' forældre-navn(e) til "… forælder"');
}
function parentIdFor_(name) { return 'p:' + String(name).toLowerCase().replace(/[^a-z0-9æøå]+/g, '-').replace(/^-|-$/g, ''); }

// Administrator: en forælder har registreret sig under barnets navn → gør e-mailen til forælder til barnet
function toParent_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var em = clean_(b.email, 120).toLowerCase();
  if (isSuper_(em)) return { ok: false, error: 'Kan ikke ændre hovedadministratoren' };
  var rows = data_('Spillere').filter(function (r) { return String(r[2]).toLowerCase().trim() === em; });
  if (!rows.length) return { ok: false, error: 'Ukendt bruger' };
  var cur = rows[rows.length - 1], curId = String(cur[0]), curName = String(cur[1]);
  if (/^p:/.test(curId)) return { ok: false, error: 'Er allerede forælder' };
  var childId = clean_(b.childId, 40) || curId, childName = clean_(b.childName, 80) || curName;
  if (kids_(em).length) return { ok: false, error: 'Brugeren er allerede registreret som forælder' };
  var newName = childName.split(' ')[0] + ' forælder', newId = parentIdFor_(newName + '-' + em.split('@')[0]);
  return withLock_(function () {
    changeIdentity_(em, newId, newName);
    var kids = kids_(em); if (!kids.some(function (k) { return k.id === childId; })) kids.push({ id: childId, name: childName });
    setKids_(em, newId, newName, kids, true);
    return { ok: true, id: newId, name: newName, kids: kids };
  });
}
// Selv: "Jeg spiller ikke i Hørsholm" — en bruger der er logget ind som spiller, men har børn (eller er administrator),
// bliver forælder med samme navn (id "p:…"). Børn, følger, push og login bevares.
function notPlayer_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  if (/^p:/.test(ses.playerId)) return { ok: false, error: 'Du er allerede registreret som forælder' };
  var em = ses.email.toLowerCase(), kids = kids_(em);
  if (!kids.length && !isAdmin_(em, ses.playerId)) return { ok: false, error: 'Tilføj først dine børn under Forælder' };
  var name = ses.playerName, newId = parentIdFor_(name + '-' + em.split('@')[0]);
  return withLock_(function () {
    changeIdentity_(em, newId, name);
    if (kids.length) setKids_(em, newId, name, kids, true);
    return { ok: true, id: newId, name: name, kids: kids_(em) };
  });
}
// Forældre må ændre deres eget navn (spillere hedder som på badmintonplayer.dk)
function rename_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  if (!/^p:/.test(ses.playerId)) return { ok: false, error: 'Kun forældre kan ændre deres navn — spillere hedder som på badmintonplayer.dk' };
  var name = clean_(b.name, 60).replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Skriv et navn' };
  return withLock_(function () { changeIdentity_(ses.email, ses.playerId, name); return { ok: true, name: name }; });
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
           leaders: data_('Ledere').length, admins: data_('Administratorer').length,
           parents: (function () { var p = {}; data_('Forældre').forEach(function (r) { p[String(r[0]).toLowerCase()] = 1; }); return Object.keys(p).length; })() };
}

function register_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var type = clean_(b.type, 10), status = clean_(b.status, 10), eventId = clean_(b.eventId, 80);
  if (!TYPES[type] || TYPES[type].indexOf(status) < 0 || !eventId) return { ok: false, error: 'Ugyldigt svar' };
  var pid = ses.playerId, pname = ses.playerName, forId = clean_(b.player, 40);
  if (forId && forId !== ses.playerId) {   // forælder svarer for sit barn
    var kid = kids_(ses.email).filter(function (k) { return k.id === forId; })[0];
    if (!kid) return { ok: false, error: 'Du kan kun svare for dine egne børn' };
    pid = kid.id; pname = kid.name;
  }
  withLock_(function () {
    sh_('Tilmeldinger').appendRow([new Date(), type, safe_(eventId), safe_(pid), safe_(pname), status, safe_(clean_(b.label, 120))]);
  });
  return { ok: true, player: { id: pid, name: pname } };
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
var ADMIN_ROOM = 'x:admin';
function memberRooms_(cx, email, pid, strict) {
  var em = String(email || '').toLowerCase().trim(), role = roleIn_(cx, em, pid), out = {};
  if (role.admin) out[ADMIN_ROOM] = 'Admin-chat';   // administratorernes egen snak
  if (strict) role = { admin: false, all: false, teams: role.teams };
  var follows = {}; cx.fol.forEach(function (r) { if (String(r[0]).toLowerCase() === em) follows[String(r[3])] = 1; });
  var kids = []; (cx.par || []).forEach(function (r) { if (String(r[0]).toLowerCase() === em) kids.push(String(r[3])); });
  var gm = APPROVAL.teamsFromLeaders ? (cx.gm || (cx.gm = groupMembers_())) : null;   // holdledernes lister — kun for hold/grupper hvor listen ikke er tom
  Object.keys(cx.teams).forEach(function (id) {
    var t = gm && (gm['h:' + id] || []).length ? { l: cx.teams[id].l, p: gm['h:' + id] } : cx.teams[id];
    if (role.admin || role.all || role.teams.indexOf(t.l) >= 0 || follows['f' + id] || t.p.indexOf(String(pid)) >= 0 ||
        kids.some(function (k) { return t.p.indexOf(k) >= 0; })) out['h:' + id] = t.l;
  });
  var groups = role.admin ? TR_GROUPS : [];
  var listed = function (g) { return gm && (gm['g:' + g] || []).length; };   // gruppe med holdlederliste: listen bestemmer
  if (gm) TR_GROUPS.forEach(function (g) { if (listed(g) && (gm['g:' + g].indexOf(String(pid)) >= 0 || kids.some(function (k) { return gm['g:' + g].indexOf(k) >= 0; }))) groups.push(g); });
  cx.grp.forEach(function (r) { if (String(r[0]).toLowerCase() === em) groups = groups.concat(String(r[2]).split(',').filter(function (g) { return !listed(g.trim()); })); });
  groups.forEach(function (g) { g = g.trim(); if (TR_GROUPS.indexOf(g) >= 0) out['g:' + g] = 'Træning · ' + g; });
  return out;
}
// Hvem må SKRIVE i chatten (alle medlemmer af et rum kan læse): administratorer, holdledere, forældre
// og spillere på et hold der ikke er ungdom. Ungdomsspillere (kun U-hold) kan kun læse.
// Voksne uden hold må kun skrive i de træningsgruppers chat de er med i (ikke holdchat, ikke Ungdom).
// Når godkendelse er slået til (APPROVAL.enabled), skal man også være godkendt.
function canWrite_(cx, email, pid, room) {
  var em = String(email || '').toLowerCase().trim(), role = roleIn_(cx, em, pid);
  if (role.admin) return { ok: true };
  if (APPROVAL.enabled && approvalOf_(em) !== 'godkendt') return { ok: false, why: 'afventer', msg: 'Din profil afventer godkendelse — du kan læse med, men ikke skrive endnu' };
  if (role.all || role.teams.length) return { ok: true };
  if (/^p:/.test(String(pid)) || (cx.par || []).some(function (r) { return String(r[0]).toLowerCase() === em; })) return { ok: true };
  var senior = Object.keys(cx.teams).some(function (id) { var t = cx.teams[id]; return !/^U\d/.test(t.l) && t.p.indexOf(String(pid)) >= 0; });
  if (senior) return { ok: true };
  var onTeam = Object.keys(cx.teams).some(function (id) { return cx.teams[id].p.indexOf(String(pid)) >= 0; });
  if (!onTeam) {   // uden hold: må skrive i sin egen træningsgruppe (ikke Ungdom), ikke i holdchat
    if (room && /^g:/.test(room) && room !== 'g:Ungdom') return { ok: true };
    return { ok: false, why: 'udenhold', msg: 'Du er ikke på holdet, så du kan læse med her, men ikke skrive. Du kan skrive i chatten for din træningsgruppe.' };
  }
  return { ok: false, why: 'ungdom', msg: 'Ungdomsspillere kan læse med i chatten, men ikke skrive. Forældre, holdledere og seniorspillere kan skrive.' };
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
             to: String(r[4]).split(',').map(function (x) { return x.trim(); }).filter(String), by: String(r[5]), img: String(r[7] || '') };
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
  var cw = canWrite_(cx, ses.email, ses.playerId, room);
  return { ok: true, room: room, title: mr[room], messages: list, canMod: canModerate_(cx, ses, room), muted: !!muted_(em)[room], canWrite: cw.ok, readOnlyMsg: cw.ok ? '' : cw.msg };
}

function post_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var room = clean_(b.room, 60), text = text_(b.text, MSG_MAX);
  if (!text) return { ok: false, error: 'Skriv en besked' };
  var cx = ctx_(), mr = memberRooms_(cx, ses.email, ses.playerId);
  if (!mr[room]) return { ok: false, error: 'Du er ikke med i ' + (/^g:/.test(room) ? 'træningsgruppen' : 'holdet') };
  var cw = canWrite_(cx, ses.email, ses.playerId, room);
  if (!cw.ok) return { ok: false, error: cw.msg, readOnly: true };
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
  var img = '';
  if (b.img) {
    var saved = newsImg_(b.img);
    if (!saved.ok) return saved;
    img = saved.id;
  }
  var id = newId_('n');
  withLock_(function () { sh_('Nyheder').appendRow([id, new Date(), safe_(title), safe_(text), to.join(','), safe_(ses.playerName), false, img]); });
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
  return { ok: true, id: id, pushed: pushed, img: img };
}
// Billede til en nyhed: appen sender et formindsket JPEG (data-URL). Det gemmes i Drive og deles med "alle med linket",
// så appen kan vise det (https://drive.google.com/thumbnail?id=…). Slettes nyheden, lægges billedet i papirkurven.
var NEWS_IMG_MAX = 2000000;   // tegn base64 ≈ 1,5 MB
function imgFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('IMG_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* mappen er slettet — opret en ny */ } }
  var f = DriveApp.createFolder('HØBK nyhedsbilleder');
  props.setProperty('IMG_FOLDER', f.getId());
  return f;
}
function newsImg_(data) {
  var m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+\/=]+)$/.exec(String(data));
  if (!m) return { ok: false, error: 'Billedet kunne ikke læses' };
  if (m[2].length > NEWS_IMG_MAX) return { ok: false, error: 'Billedet er for stort' };
  try {
    var ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), 'image/' + m[1], 'nyhed-' + Utilities.formatDate(new Date(), 'Europe/Copenhagen', 'yyyy-MM-dd-HHmmss') + '.' + ext);
    var f = imgFolder_().createFile(blob);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, id: f.getId() };
  } catch (e) {
    return { ok: false, error: 'Billedet kunne ikke gemmes — kør setup i Apps Script og giv adgang til Google Drive' };
  }
}
function newsDel_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var id = clean_(b.id, 40);
  return withLock_(function () {
    var rows = data_('Nyheder');
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) {
      sh_('Nyheder').getRange(i + 2, 7).setValue(true);
      if (rows[i][7]) { try { DriveApp.getFileById(String(rows[i][7])).setTrashed(true); } catch (e) { /* billedet er allerede væk */ } }
      return { ok: true };
    }
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
             cal: bool_(r[6]), to: String(r[7]).split(',').map(function (x) { return x.trim(); }).filter(String), by: String(r[8]), del: bool_(r[9]), tasks: tasks, help: bool_(r[11]), link: String(r[12] || '') };
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
  return { id: a.id, name: a.name, desc: a.desc, start: a.start, end: a.end, cal: a.cal, to: a.to, by: a.by, help: !!a.help, link: a.link || '',
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
  if (b.help && !(b.tasks || []).some(function (t) { return clean_(t && t.title, 80); })) return { ok: false, error: 'Tilføj mindst én opgave, når I søger hjælp' };
  var tasks = (b.tasks || []).slice(0, 40).map(function (t) {
    var from = dtOk_(String(t.from || '')) ? String(t.from) : '', to = dtOk_(String(t.to || '')) ? String(t.to) : '';
    if (from && to && to < from) to = from;
    return { id: /^o[0-9a-z]+$/.test(String(t.id || '')) ? String(t.id) : newId_('o'), title: clean_(t.title, 80), need: Math.max(0, Math.min(99, parseInt(t.need, 10) || 0)), from: from, to: to };
  }).filter(function (t) { return t.title; });
  var badTime = tasks.filter(function (t) { return t.from && (t.from < start.slice(0, 10) + 'T00:00' || t.from > end); })[0];
  if (badTime) return { ok: false, error: 'Tiden for "' + badTime.title + '" ligger uden for aktiviteten' };
  var link = clean_(b.link, 500);   // fx tilmelding og betaling i Conventus
  if (link && !/^https:\/\/[^\s"'<>]+$/i.test(link)) return { ok: false, error: 'Linket skal starte med https://' };
  var id = /^a[0-9a-z]+$/.test(String(b.id || '')) ? String(b.id) : '';
  var isNew = !id;
  withLock_(function () {
    var sh = sh_('Aktiviteter');
    if (id) {
      var cur = actRows_().filter(function (a) { return a.id === id; })[0];
      if (!cur) { id = ''; isNew = true; }
      else sh.getRange(cur.row, 3, 1, 11).setValues([[safe_(name), safe_(desc), start, end, !!b.cal, to.join(','), safe_(ses.playerName), false, JSON.stringify(tasks), !!b.help, link]]);
    }
    if (!id) { id = newId_('a'); sh.appendRow([id, new Date(), safe_(name), safe_(desc), start, end, !!b.cal, to.join(','), safe_(ses.playerName), false, JSON.stringify(tasks), !!b.help, link]); }
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

// ---------- Samkørsel (holdkampe og turneringer) ----------
// Begivenhed: "m:<matchID>" (holdkamp) eller "t:<turneringId>". Én række pr. person (eller barn) pr. begivenhed.
// valg: drive = kører (pladser = ledige pladser, opsamling = "vej" (henter på vejen) eller et mødested, afgang = HH:MM)
//       need  = mangler lift (chauffør = playerId på den bil man har taget plads i, note = hvor man kan hentes)
//       own   = kører selv / kommer selv
var RIDE_MODES = ['drive', 'need', 'own'];
function rideRows_(ev) {
  var out = [];
  data_('Kørsel').forEach(function (r, i) {
    if (String(r[1]) !== ev) return;
    out.push({ row: i + 2, p: String(r[3]), n: String(r[4]), email: String(r[5]).toLowerCase(), mode: String(r[6]), seats: Number(r[7]) || 0,
               pickup: String(r[8] || ''), time: String(r[9] || ''), driver: String(r[10] || ''), note: String(r[11] || ''), title: String(r[2] || '') });
  });
  return out;
}
function ridePub_(rows, em, kidIds) {
  // Forældre: et barn som forælderen har meldt → by = forælderens navn. En forælder → kids = forælderens børn (så man kan se hvis forælder det er)
  var par = data_('Forældre'), pname = {}, kidsOf = {};
  par.forEach(function (r) {
    var e = String(r[0]).toLowerCase();
    pname[e + '|' + String(r[3])] = String(r[2]);
    (kidsOf[e] = kidsOf[e] || []).push({ id: String(r[3]), n: String(r[4]) });
  });
  return rows.filter(function (r) { return RIDE_MODES.indexOf(r.mode) >= 0; }).map(function (r) {
    var by = pname[r.email + '|' + r.p] || '';
    return { p: r.p, n: r.n, mode: r.mode, seats: r.seats, pickup: r.pickup, time: r.time, driver: r.driver, note: r.note,
             mine: r.p === kidIds.self || kidIds[r.p] === 1 || (r.email === em && !by), by: by, kids: by ? [] : (kidsOf[r.email] || []) };
  });
}
// Ungdomskamp/-turnering: kun forældre (og voksne) melder samkørsel — ungdomsspillere kan ikke selv vælge.
function rideYouthBlock_(b, ses, who) {
  if (who.kid) return '';
  var team = clean_(b.team, 20), cx = ctx_(), youth = !!b.youth;
  if (team && cx.teams[team]) youth = /^U\d/.test(cx.teams[team].l);
  if (!youth) return '';
  return canWrite_(cx, ses.email, ses.playerId, null).why === 'ungdom' ? 'Til ungdomskampe er det forældrene der melder samkørsel — bed din forælder om at gøre det i appen' : '';
}
function rideWho_(ses, forId) {   // hvem svarer man for: sig selv eller et af sine børn (label bruges i push: "Oliver (Per Hansen)")
  if (!forId || forId === ses.playerId) return { id: ses.playerId, name: ses.playerName, kid: false, label: ses.playerName };
  var kid = kids_(ses.email).filter(function (k) { return k.id === forId; })[0];
  return kid ? { id: kid.id, name: kid.name, kid: true, label: kid.name + ' (' + ses.playerName + ')' } : null;
}
// Ens egen række: samme playerId — eller samme e-mail (ikke et barn), hvis man har skiftet id siden (fx spiller → forælder).
// Så rettes rækken til det nye id, og passagerernes chauffør-henvisning følger med.
function rideMine_(rows, who, em, sh) {
  var mine = rows.filter(function (r) { return r.p === who.id; })[0];
  if (mine || who.kid) return mine;
  var kids = {}; kids_(em).forEach(function (k) { kids[k.id] = 1; });
  mine = rows.filter(function (r) { return r.email === em && !kids[r.p]; })[0];
  if (!mine) return null;
  var old = mine.p;
  sh.getRange(mine.row, 4, 1, 2).setValues([[safe_(who.id), safe_(who.name)]]);
  rows.forEach(function (r) { if (r.driver === old) { r.driver = who.id; sh.getRange(r.row, 11).setValue(safe_(who.id)); } });
  mine.p = who.id; mine.n = who.name;
  return mine;
}
function rideIds_(ses) { var o = { self: ses.playerId }; kids_(ses.email).forEach(function (k) { o[k.id] = 1; }); return o; }
function rideEv_(b) { var ev = clean_(b.event, 80); return /^[mt]:[\w:.\- æøåÆØÅ]+$/.test(ev) ? ev : ''; }
function rideLink_(b) { var l = clean_(b.link, 120); return /^#\/(holdid\/\d+(\/kamp\/\d+)?|turnering\/[\w%.\-]+)$/.test(l) ? l : ''; }
function ridePush_(emails, title, text, link, tag) {
  var want = {}; emails.forEach(function (e) { if (e) want[e] = 1; });
  if (!Object.keys(want).length) return 0;
  var jobs = pushTargets_(null, function (em) { return !!want[em]; }).map(function (t) {
    return [new Date(), t.endpoint, t.p256dh, t.auth, clean_(title, 80), clean_(text, 140), APP_URL + (link || ''), tag];
  });
  queuePush_(jobs);
  return jobs.length;
}
function rides_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var ev = rideEv_(b); if (!ev) return { ok: false, error: 'Ukendt kamp' };
  return { ok: true, event: ev, rides: ridePub_(rideRows_(ev), ses.email.toLowerCase(), rideIds_(ses)) };
}
function rideSet_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var ev = rideEv_(b); if (!ev) return { ok: false, error: 'Ukendt kamp' };
  var who = rideWho_(ses, clean_(b.player, 40));
  if (!who) return { ok: false, error: 'Du kan kun svare for dig selv og dine egne børn' };
  var mode = clean_(b.mode, 10);
  if (mode !== 'clear' && RIDE_MODES.indexOf(mode) < 0) return { ok: false, error: 'Ugyldigt valg' };
  var yb = rideYouthBlock_(b, ses, who); if (yb) return { ok: false, error: yb };
  if (mode === 'drive' && who.kid) return { ok: false, error: 'Et barn kan ikke være chauffør' };
  var seats = Math.max(0, Math.min(8, Math.floor(Number(b.seats) || 0)));
  if (mode === 'drive' && seats < 1) return { ok: false, error: 'Vælg mindst 1 ledig plads' };
  var pickup = mode === 'drive' ? (clean_(b.pickup, 80) || 'vej') : '';
  var time = mode === 'drive' && /^\d{1,2}[:.]\d{2}$/.test(clean_(b.time, 5)) ? clean_(b.time, 5).replace('.', ':') : '';
  var note = mode === 'need' ? clean_(b.note, 80) : '';
  var title = clean_(b.title, 120), link = rideLink_(b), em = ses.email.toLowerCase(), notify = [];
  var res = withLock_(function () {
    var rows = rideRows_(ev), sh = sh_('Kørsel'), mine = rideMine_(rows, who, em, sh);
    var pass = rows.filter(function (r) { return r.mode === 'need' && r.driver === who.id; });
    if (mode === 'drive' && pass.length > seats) return { ok: false, error: 'Du har allerede ' + pass.length + ' passagerer — vælg mindst ' + pass.length + ' pladser' };
    if (mine && mine.mode === 'drive' && mode !== 'drive' && pass.length) {   // chaufføren kører ikke alligevel: passagererne mangler igen et lift
      pass.forEach(function (r) { sh.getRange(r.row, 11).setValue(''); notify.push({ em: r.email, t: who.name + ' kører ikke alligevel', x: r.n.split(' ')[0] + ' mangler igen et lift' + (title ? ' · ' + title : '') }); });
    } else if (mine && mine.mode === 'drive' && mode === 'drive' && pass.length && (mine.pickup !== pickup || mine.time !== time)) {
      pass.forEach(function (r) { notify.push({ em: r.email, t: 'Ny opsamling hos ' + who.name, x: (pickup === 'vej' ? 'Henter på vejen' : 'Mødested: ' + pickup) + (time ? ' kl. ' + time : '') + (title ? ' · ' + title : '') }); });
    }
    var driver = mode === 'need' && mine && mine.mode === 'need' ? mine.driver : '';
    var vals = [new Date(), safe_(ev), safe_(title || (mine && mine.title) || ''), safe_(who.id), safe_(who.name), em, mode === 'clear' ? 'ryd' : mode, mode === 'drive' ? seats : '',
                safe_(pickup), time, safe_(driver), safe_(note)];
    if (mine) sh.getRange(mine.row, 1, 1, vals.length).setValues([vals]); else if (mode !== 'clear') sh.appendRow(vals);
    if (mine && mine.mode === 'need' && mine.driver && mode !== 'need') {   // forlod en bil ved at skifte valg
      var d = rows.filter(function (r) { return r.p === mine.driver && r.mode === 'drive'; })[0];
      if (d) notify.push({ em: d.email, t: who.label + ' kører ikke med alligevel', x: 'Der er en plads mere i din bil' + (title ? ' · ' + title : '') });
    }
    return { ok: true };
  });
  if (!res.ok) return res;
  notify.forEach(function (n) { try { ridePush_([n.em], n.t, n.x, link, 'k:' + ev); } catch (e) {} });
  return { ok: true, event: ev, rides: ridePub_(rideRows_(ev), em, rideIds_(ses)) };
}
function rideTake_(b) {   // tag en plads i en bil (driver = chaufførens playerId) eller forlad den (driver = '')
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var ev = rideEv_(b); if (!ev) return { ok: false, error: 'Ukendt kamp' };
  var who = rideWho_(ses, clean_(b.player, 40));
  if (!who) return { ok: false, error: 'Du kan kun svare for dig selv og dine egne børn' };
  var yb = rideYouthBlock_(b, ses, who); if (yb) return { ok: false, error: yb };
  var did = clean_(b.driver, 40), title = clean_(b.title, 120), link = rideLink_(b), em = ses.email.toLowerCase(), notify = null;
  var res = withLock_(function () {
    var rows = rideRows_(ev), sh = sh_('Kørsel'), mine = rideMine_(rows, who, em, sh);
    if (did) {
      if (did === who.id) return { ok: false, error: 'Du kan ikke tage plads i din egen bil' };
      var d = rows.filter(function (r) { return r.p === did && r.mode === 'drive'; })[0];
      if (!d) return { ok: false, error: 'Bilen findes ikke længere' };
      if (mine && mine.mode === 'need' && mine.driver === did) return { ok: true };
      var taken = rows.filter(function (r) { return r.mode === 'need' && r.driver === did; }).length;
      if (taken >= d.seats) return { ok: false, error: 'Bilen er fuld' };
      if (mine && mine.mode === 'drive' && rows.some(function (r) { return r.mode === 'need' && r.driver === who.id; })) return { ok: false, error: 'Du har selv passagerer — skift først dit eget valg' };
      notify = { em: d.email, t: who.label + ' kører med dig', x: (taken + 1) + ' af ' + d.seats + ' pladser taget' + (title ? ' · ' + title : '') };
    } else if (mine && mine.driver) {
      var od = rows.filter(function (r) { return r.p === mine.driver && r.mode === 'drive'; })[0];
      if (od) notify = { em: od.email, t: who.label + ' kører ikke med alligevel', x: 'Der er en plads mere i din bil' + (title ? ' · ' + title : '') };
    }
    var vals = [new Date(), safe_(ev), safe_(title || (mine && mine.title) || ''), safe_(who.id), safe_(who.name), em, 'need', '', '', '', safe_(did), safe_(mine && mine.mode === 'need' ? mine.note : '')];
    if (mine) sh.getRange(mine.row, 1, 1, vals.length).setValues([vals]); else sh.appendRow(vals);
    return { ok: true };
  });
  if (!res.ok) return res;
  if (notify) { try { ridePush_([notify.em], notify.t, notify.x, link, 'k:' + ev); } catch (e) {} }
  return { ok: true, event: ev, rides: ridePub_(rideRows_(ev), em, rideIds_(ses)) };
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

// ======================================================================================
// GODKENDELSE OG HOLDMEDLEMSKAB — FORBEREDT, IKKE SLÅET TIL
// Slå til ved at sætte felterne nedenfor til true og udgive en ny version. Hele flowet: docs/GODKENDELSE.md
//  enabled          nye spillere og forældre skal godkendes af en administrator, før de kan skrive i chatten
//  since            dato (YYYY-MM-DD) hvor godkendelse blev slået til — alle der havde logget ind før, er godkendt automatisk
//  memberCheck      spillere skal have en e-mail der står i fanen Medlemmer (eksport fra medlemssystemet)
//  teamsFromLeaders holdlederne bestemmer hvem der er på deres hold og i træningsgrupperne (fanen Holdmedlemmer)
//                   i stedet for badmintonplayer.dk og spillernes eget valg
// ======================================================================================
var APPROVAL = { enabled: false, since: '', memberCheck: false, teamsFromLeaders: true };   // holdlister slået til 5. nov 2026 (tom liste = som før)

function requestApprovalLocked_(email, pid, pname) {   // verify_ holder allerede låsen
  var w = withLock_; withLock_ = function (fn) { return fn(); };
  try { return requestApproval_(email, pid, pname); } finally { withLock_ = w; }
}
function approvalOf_(email) {   // 'godkendt' | 'afventer' | 'afvist' | '' (ingen anmodning)
  var em = String(email || '').toLowerCase().trim(), st = '';
  data_('Godkendelser').forEach(function (r) { if (String(r[1]).toLowerCase() === em) st = String(r[5]); });
  if (!st && existedBefore_(em)) st = 'godkendt';
  return st;
}
// Brugere der havde bekræftet deres e-mail før APPROVAL.since, er godkendt automatisk (besluttet 1. nov 2026)
function existedBefore_(email) {
  if (!APPROVAL.since) return false;
  var cut = new Date(APPROVAL.since + 'T00:00:00').getTime();
  return data_('Spillere').some(function (r) { return String(r[2]).toLowerCase().trim() === email && ts_(r[3]) && ts_(r[3]) < cut; });
}
function isMember_(email) {   // står e-mailen i medlemssystemet? (Conventus har kun medlemmets egen e-mail — ikke forældres)
  var em = String(email || '').toLowerCase().trim();
  return data_('Medlemmer').some(function (r) { return String(r[0]).toLowerCase().trim() === em; });
}
function adminEmails_() {
  var out = data_('Administratorer').map(function (r) { return String(r[0]).toLowerCase(); }).filter(String);
  data_('Spillere').forEach(function (r) { if (ADMIN_PLAYER_IDS.indexOf(String(r[0])) >= 0) out.push(String(r[2]).toLowerCase()); });
  return out.filter(function (e, i) { return e && out.indexOf(e) === i && !isSuper_(e); });   // hovedadministratoren får ingen rutine-mails
}
// Kaldes fra verify_ når APPROVAL.enabled: opretter en anmodning første gang man logger ind
function requestApproval_(email, pid, pname) {
  var em = String(email || '').toLowerCase().trim();
  if (isAdmin_(em, pid) || approvalOf_(em)) return approvalOf_(em) || 'godkendt';
  var role = /^p:/.test(String(pid)) ? 'forælder' : 'spiller', note = role === 'forælder' ? 'forælder — godkendes individuelt' : '';
  if (role === 'spiller' && APPROVAL.memberCheck && !isMember_(em)) {
    note = 'ikke i medlemssystemet';
    try {
      if (MailApp.getRemainingDailyQuota() > 2) {
        MailApp.sendEmail({ to: em, name: CLUB, subject: 'HØBK-appen: din e-mail står ikke i medlemssystemet',
          body: 'Hej ' + pname.split(' ')[0] + '\n\nDu har oprettet dig i HØBK-appen som spiller med ' + em + ', men den e-mail står ikke i klubbens medlemssystem.\n' +
                'Ret din e-mail i medlemssystemet (eller kontakt klubben), så kan din profil blive godkendt.\n\nIndtil da kan du se kampe og læse med, men ikke skrive i chatten.\n\n' + CLUB });
        var admins = adminEmails_();
        if (admins.length) MailApp.sendEmail({ to: admins.join(','), name: CLUB, subject: 'HØBK-appen: ' + pname + ' er ikke i medlemssystemet',
          body: pname + ' (' + em + ') har oprettet sig som spiller, men e-mailen står ikke i medlemssystemet.\nGodkend eller afvis under Administration → Godkendelser, når det er løst.\n\n' + CLUB });
      }
    } catch (e) {}
  }
  withLock_(function () { sh_('Godkendelser').appendRow([new Date(), em, safe_(pid), safe_(pname), role, 'afventer', note, '', '']); });
  return 'afventer';
}
// Kun administratorer godkender/afviser (besluttet 1. nov 2026) — spillere og forældre hver for sig
function approve_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  if (!isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administratorer kan godkende' };
  var em = clean_(b.email, 120).toLowerCase();
  var row = null; data_('Godkendelser').forEach(function (r) { if (String(r[1]).toLowerCase() === em) row = r; });
  if (!row) return { ok: false, error: 'Ingen anmodning for ' + em };
  var st = b.on ? 'godkendt' : 'afvist';
  withLock_(function () { sh_('Godkendelser').appendRow([new Date(), em, safe_(String(row[2])), safe_(String(row[3])), String(row[4]), st, safe_(clean_(b.note, 200)), safe_(ses.playerName), new Date()]); });
  return { ok: true, status: st };
}
function pendingList_(b) {
  var ses = session_(b.token);
  if (!ses || !isAdmin_(ses.email, ses.playerId)) return { ok: false, error: 'Kun administrator' };
  var last = {};
  data_('Godkendelser').forEach(function (r) { last[String(r[1]).toLowerCase()] = r; });
  return { ok: true, pending: Object.keys(last).map(function (k) { return last[k]; }).filter(function (r) { return String(r[5]) === 'afventer'; })
    .map(function (r) { return { email: String(r[1]), id: String(r[2]), name: String(r[3]), role: String(r[4]), note: String(r[6]), t: ts_(r[0]), member: isMember_(r[1]) }; }) };
}
// Holdlederen bestemmer hvem der er på holdet (gruppe "h:<holdId>") eller i en træningsgruppe ("g:<gruppe>")
var GROUP_OF_TEAM = function (label) { return /^U\d/.test(label) ? 'Ungdom' : /^MOT/.test(label) ? 'Voksenfjer' : /A-række/.test(label) ? 'Veteran' : 'Senior'; };
function canManageGroup_(cx, role, group) {
  if (role.admin || role.all) return true;
  if (/^h:/.test(group)) { var t = cx.teams[group.slice(2)]; return !!t && role.teams.indexOf(t.l) >= 0; }
  if (/^g:/.test(group)) {   // træningsgruppe: holdledere for et hold i samme aldersgruppe
    var g = group.slice(2).replace(/2$/, '');
    return Object.keys(cx.teams).some(function (id) { var t = cx.teams[id]; return role.teams.indexOf(t.l) >= 0 && GROUP_OF_TEAM(t.l) === g; });
  }
  return false;
}
function setGroupMember_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var cx = ctx_(), role = roleIn_(cx, ses.email, ses.playerId), group = clean_(b.group, 60), pid = clean_(b.playerId, 40);
  if (Array.isArray(b.players) && !pid) pid = '*';
  if (!/^(h:\d+|g:[A-Za-zæøåÆØÅ0-9]+)$/.test(group) || !pid) return { ok: false, error: 'Ukendt hold eller spiller' };
  if (!canManageGroup_(cx, role, group)) return { ok: false, error: 'Kun holdlederen for holdet kan ændre det' };
  var list = (Array.isArray(b.players) ? b.players : [{ id: pid, name: b.name }]).slice(0, 200)
    .map(function (x) { return { id: clean_(x && x.id, 40), name: clean_(x && x.name, 80) }; }).filter(function (x) { return x.id; });
  var ids = {}; list.forEach(function (x) { ids[x.id] = 1; });
  return withLock_(function () {
    var sh = sh_('Holdmedlemmer'), rows = data_('Holdmedlemmer');
    for (var i = rows.length - 1; i >= 0; i--) if (ids[String(rows[i][0])] && String(rows[i][2]) === group) sh.deleteRow(i + 2);
    if (b.on && list.length) { var now = new Date(); sh.getRange(sh.getLastRow() + 1, 1, list.length, 5).setValues(list.map(function (x) { return [safe_(x.id), safe_(x.name), group, safe_(ses.playerName), now]; })); }
    return { ok: true, members: data_('Holdmedlemmer').filter(function (r) { return String(r[2]) === group; }).map(function (r) { return { id: String(r[0]), name: String(r[1]) }; }) };
  });
}
function groupLists_(b) {   // holdlisterne man selv må ændre (administrator: alle)
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var cx = ctx_(), role = roleIn_(cx, ses.email, ses.playerId), out = {};
  data_('Holdmedlemmer').forEach(function (r) {
    var g = String(r[2]); if (!canManageGroup_(cx, role, g)) return;
    (out[g] = out[g] || []).push({ id: String(r[0]), name: String(r[1]), by: String(r[3]), t: ts_(r[4]) });
  });
  return { ok: true, on: !!APPROVAL.teamsFromLeaders, lists: out };
}
function groupMembers_() {   // {gruppe: [playerId…]} fra Holdmedlemmer (bruges når APPROVAL.teamsFromLeaders)
  var m = {}; data_('Holdmedlemmer').forEach(function (r) { var g = String(r[2]); (m[g] = m[g] || []).push(String(r[0])); });
  return m;
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Ugyldig forespørgsel' }); }
  try {
    switch (b.action) {
      case 'request': return json_(request_(b));
      case 'verify': return json_(verify_(b));
      case 'deviceCode': return json_(deviceCode_(b));
      case 'deviceLogin': return json_(deviceLogin_(b));
      case 'register': return json_(register_(b));
      case 'lineup': return json_(saveLineup_(b));
      case 'leaders': return json_(leaders_(b));
      case 'setLeader': return json_(setLeader_(b));
      case 'setAdmin': return json_(setAdmin_(b));
      case 'users': return json_(users_(b));
      case 'toParent': return json_(toParent_(b));
      case 'rename': return json_(rename_(b));
      case 'notPlayer': return json_(notPlayer_(b));
      case 'follow': return json_(follow_(b));
      case 'notify': return json_(notify_(b));
      case 'push': return json_(push_(b));
      case 'prefs': return json_(prefs_(b));
      case 'pushGone': return json_(pushGone_(b));
      case 'children': return json_(children_(b));
      case 'approve': return APPROVAL.enabled ? json_(approve_(b)) : json_({ ok: false, error: 'Godkendelse er ikke slået til' });
      case 'pending': return APPROVAL.enabled ? json_(pendingList_(b)) : json_({ ok: true, pending: [], off: true });
      case 'groupList': return json_(groupLists_(b));
      case 'groupMember': return APPROVAL.teamsFromLeaders ? json_(setGroupMember_(b)) : json_({ ok: false, error: 'Holdledernes holdlister er ikke slået til' });
      case 'acts': return json_(acts_(b));
      case 'actSave': return json_(actSave_(b));
      case 'actDel': return json_(actDel_(b));
      case 'taskSign': return json_(taskSign_(b));
      case 'rides': return json_(rides_(b));
      case 'rideSet': return json_(rideSet_(b));
      case 'rideTake': return json_(rideTake_(b));
      case 'rooms': return json_(rooms_(b));
      case 'messages': return json_(messages_(b));
      case 'post': return json_(post_(b));
      case 'delMsg': return json_(delMsg_(b));
      case 'mute': return json_(mute_(b));
      case 'newsSave': return json_(newsSave_(b));
      case 'newsDel': return json_(newsDel_(b));
      case 'newsList': return json_(newsList_(b));
      case 'fbSend': return json_(fbSend_(b));
      case 'fbMine': return json_(fbMine_(b));
      case 'fbList': return json_(fbList_(b));
      case 'fbReply': return json_(fbReply_(b));
      case 'fbStatus': return json_(fbStatus_(b));
      case 'fbToChat': return json_(fbToChat_(b));
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
  if (action === 'ideas') {   // admin-chatten, kun læsning, kræver IDEAS_KEY (ikke REG_KEY)
    var ik = PropertiesService.getScriptProperties().getProperty('IDEAS_KEY');
    if (!ik || e.parameter.key !== ik) return json_({ ok: false, error: 'Forkert nøgle' });
    var since = Number(e.parameter.since || 0);
    return json_({ ok: true, messages: tail_('Beskeder', TAIL).rows.filter(function (r) { return String(r[2]) === ADMIN_ROOM && !bool_(r[7]) && ts_(r[1]) > since; })
      .map(function (r) { return { id: String(r[0]), t: (r[1] instanceof Date ? r[1] : new Date(r[1])).toISOString(), n: String(r[4]), x: String(r[6]) }; }).slice(-300) });
  }
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

// ======================================================================================
// HJÆLP OG FEEDBACK — brugerne skriver til administratorerne (spørgsmålstegnet øverst i appen).
// Administratorerne ser alt under Min side → Admin → Feedback, kan svare (med push til afsenderen)
// og sende en henvendelse videre til admin-chatten, hvis den skal laves.
// ======================================================================================
var FB_TYPES = ['idé', 'fejl', 'spørgsmål', 'andet'], FB_MAX = 2000, FB_PER_HOUR = 6;
function fbOut_(r, admin) {
  var o = { id: String(r[0]), t: ts_(r[1]), pid: String(r[3]), n: String(r[4]), type: String(r[5]), x: String(r[6]), side: String(r[7]),
            st: String(r[9] || 'ny'), svar: String(r[10] || ''), by: String(r[11] || ''), st2: ts_(r[12]), chat: ts_(r[13]) };
  if (admin) { o.email = String(r[2]); o.dev = String(r[8]); }
  return o;
}
function fbAdmin_(b) {
  var ses = session_(b.token);
  if (!ses) return { err: { ok: false, error: 'login', message: 'Log ind igen' } };
  if (!isAdmin_(ses.email, ses.playerId)) return { err: { ok: false, error: 'Kun for administratorer' } };
  return { ses: ses };
}
function fbRow_(id) {   // [rækkenummer, række] eller null
  var rows = data_('Feedback');
  for (var i = rows.length - 1; i >= 0; i--) if (String(rows[i][0]) === id) return [i + 2, rows[i]];
  return null;
}
function fbSend_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var type = FB_TYPES.indexOf(clean_(b.type, 20)) >= 0 ? clean_(b.type, 20) : 'andet';
  var text = text_(b.text, FB_MAX);
  if (text.length < 3) return { ok: false, error: 'Skriv lidt mere' };
  var side = clean_(b.side, 120), dev = clean_(b.dev, 160), em = ses.email.toLowerCase();
  var out = withLock_(function () {
    var hour = Date.now() - 3600000;
    if (data_('Feedback').filter(function (r) { return String(r[2]).toLowerCase() === em && ts_(r[1]) > hour; }).length >= FB_PER_HOUR) return null;
    var id = newId_('f'), now = new Date();
    var row = [id, now, em, safe_(ses.playerId), safe_(ses.playerName), type, safe_(text), safe_(side), safe_(dev), 'ny', '', '', '', ''];
    sh_('Feedback').appendRow(row);
    return fbOut_(row, false);
  });
  if (!out) return { ok: false, error: 'Du har sendt mange henvendelser den sidste time — prøv igen senere' };
  try {   // push til administratorerne
    var cx = ctx_();
    queuePush_(pushTargets_(cx, function (e, pid) { return e !== em && roleIn_(cx, e, pid).admin; }).map(function (r) {
      return [new Date(), r.endpoint, r.p256dh, r.auth, clean_('Ny feedback · ' + type + ' · ' + ses.playerName.split(' ')[0], 80), clean_(text, 140), APP_URL + '#/feedback', 'fb'];
    }));
  } catch (e) {}
  return { ok: true, item: out };
}
function fbMine_(b) {
  var ses = session_(b.token);
  if (!ses) return { ok: false, error: 'login', message: 'Log ind igen' };
  var em = ses.email.toLowerCase();
  return { ok: true, items: data_('Feedback').filter(function (r) { return String(r[2]).toLowerCase() === em; })
    .map(function (r) { return fbOut_(r, false); }).reverse().slice(0, 50) };
}
function fbList_(b) {
  var a = fbAdmin_(b); if (a.err) return a.err;
  return { ok: true, items: data_('Feedback').map(function (r) { return fbOut_(r, true); }).reverse().slice(0, 300) };
}
function fbReply_(b) {
  var a = fbAdmin_(b); if (a.err) return a.err;
  var id = clean_(b.id, 40), text = text_(b.text, FB_MAX);
  if (!text) return { ok: false, error: 'Skriv et svar' };
  var res = withLock_(function () {
    var f = fbRow_(id); if (!f) return null;
    var now = new Date();
    sh_('Feedback').getRange(f[0], 10, 1, 4).setValues([['besvaret', safe_(text), safe_(a.ses.playerName), now]]);
    f[1][9] = 'besvaret'; f[1][10] = text; f[1][11] = a.ses.playerName; f[1][12] = now;
    return f[1];
  });
  if (!res) return { ok: false, error: 'Henvendelsen findes ikke' };
  try {   // push til den der skrev
    var to = String(res[2]).toLowerCase();
    queuePush_(pushTargets_(ctx_(), function (e) { return e === to; }).map(function (r) {
      return [new Date(), r.endpoint, r.p256dh, r.auth, 'Svar på din feedback', clean_(text, 140), APP_URL + '#/hjaelp', 'fb:' + id];
    }));
  } catch (e) {}
  return { ok: true, item: fbOut_(res, true) };
}
function fbStatus_(b) {
  var a = fbAdmin_(b); if (a.err) return a.err;
  var id = clean_(b.id, 40), st = clean_(b.status, 20);
  if (['ny', 'besvaret', 'lukket'].indexOf(st) < 0) return { ok: false, error: 'Ugyldig status' };
  var res = withLock_(function () {
    var f = fbRow_(id); if (!f) return null;
    sh_('Feedback').getRange(f[0], 10).setValue(st); f[1][9] = st; return f[1];
  });
  return res ? { ok: true, item: fbOut_(res, true) } : { ok: false, error: 'Henvendelsen findes ikke' };
}
function fbToChat_(b) {   // send henvendelsen videre til admin-chatten (som en almindelig besked fra administratoren)
  var a = fbAdmin_(b); if (a.err) return a.err;
  var id = clean_(b.id, 40), f = fbRow_(id);
  if (!f) return { ok: false, error: 'Henvendelsen findes ikke' };
  var r = f[1], note = text_(b.note, 400);
  var head = '💡 Feedback fra ' + String(r[4]) + ' (' + String(r[5]) + (r[7] ? ', skærm ' + String(r[7]) : '') + '):\n';
  var tail = note ? '\n\n' + a.ses.playerName.split(' ')[0] + ': ' + note : '';
  var body = String(r[6]);
  if ((head + body + tail).length > MSG_MAX) body = body.slice(0, Math.max(50, MSG_MAX - head.length - tail.length - 2)) + ' …';
  var p = post_({ token: b.token, room: ADMIN_ROOM, text: head + body + tail });
  if (!p.ok) return p;
  var res = withLock_(function () {
    var g = fbRow_(id); if (!g) return null;
    sh_('Feedback').getRange(g[0], 14).setValue(new Date()); g[1][13] = new Date(); return g[1];
  });
  return { ok: true, item: res ? fbOut_(res, true) : null };
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
