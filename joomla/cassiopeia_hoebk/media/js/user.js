/* =====================================================================
   HØBK — forsiden i det nye look (Cassiopeia-undertema "cassiopeia_hoebk")

   Alt indhold kommer fra hjemmesiden selv, så det rettes de samme steder som før:
   - Hero: teksten i banner-modulet (overskrift → mærkat, undertekst → kortet på fotoet)
     og banner-modulets baggrundsbillede.
   - "Find dit hold" og "Ugeplan": træningstiderne i footer-modulet ("Træningstider: ...").
   - "Holdkampe": hentes automatisk fra HØBK-appen (badmintonplayer.dk), opdateres dagligt.
   - Resten af forsiden: forsideartiklen, delt op i kort ved hver vandret linje (<hr>).
   Teksterne herunder (HB) kan rettes i Joomla: Systemet → Site-skabeloner → HØBK → user.js.
   Virker scriptet ikke, vises siden stadig — bare uden de nye forsidesektioner.
   ===================================================================== */
(function () {
  'use strict';

  var HB = {
    heroTitle: '',   // tom = brug "Sidebeskrivelse" fra skabelonstilen ("HØBK - her har vi det sjovt!")
    heroText: 'Hørsholm Badminton Klub har træning for ungdom, senior, voksne motionister og veteraner — i hallen på Stadion Allé i Rungsted Kyst.',
    heroButtons: [
      { text: 'Find dit hold', href: '#hb-hold', lime: true },
      { text: 'Se kalenderen', href: '/kalender' }
    ],
    groups: [
      { title: 'Ungdom', kicker: 'Børn og unge', href: '/ungdom', match: /^ungdom/i, lime: true },
      { title: 'Senior', kicker: 'Konkurrence', href: '/senior', match: /^senior/i },
      { title: 'Voksenfjer', kicker: 'Motion', href: '/voksenfjer', match: /^voksen/i },
      { title: 'Veteran', kicker: 'Veteraner', href: '/veteran', match: /^veteran/i }
    ],
    signupHref: '/tilmelding',
    app: 'https://christoffergroenfeldt-cyber.github.io/Hoebk/',
    matchData: 'https://christoffergroenfeldt-cyber.github.io/Hoebk/data/hjemmeside.json',
    bpClub: 'https://badmintonplayer.dk/DBF/HoldTurnering/Stilling/#2,2026,,,,,,1151,',
    privacyHref: '/om-klubben/privatlivspolitiker'
  };

  var DAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
  var DAYS_UC = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

  // ---------- små hjælpere ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'cls') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function txt(n) { return (n && n.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function dash(s) { return s.replace(/(\d)\s*-\s*(\d)/g, '$1–$2').replace(/([a-zæøå])-([A-ZÆØÅa-zæøå])/g, '$1–$2'); }

  function onReady(f) { if (document.readyState !== 'loading') f(); else document.addEventListener('DOMContentLoaded', f); }

  onReady(function () {
    var root = document.documentElement;
    root.classList.add('hb-js');
    var isHome = !!$('.container-header .metismenu-item.default.current, .container-header .metismenu-item.default.active') ||
      /^\/(index\.php)?$/.test(location.pathname);
    if (isHome) document.body.classList.add('hb-home');
    safe(footer);
    if (!isHome) return;
    var plan = safe(readTrainingTimes) || [];
    safe(hero);
    var host = $('.container-component');
    var main = host && $('main', host);
    if (!host || !main) return;
    var wrap = el('div', { cls: 'hb-front' });
    host.insertBefore(wrap, main);
    safe(function () { teams(wrap, plan); });
    safe(function () { week(wrap, plan); });
    safe(function () { matches(wrap); });
    safe(function () { appPromo(wrap); });
    safe(blocks);
    var first = wrap.firstElementChild; if (first) first.classList.add('hb-first');
  });

  function safe(f) { try { return f(); } catch (e) { if (window.console) console.warn('HØBK-skabelon:', e); } }

  // ---------- Træningstider fra footer-modulet ----------
  // "Ungdom: Mandag 15:30-19:15 * Tirsdag-Torsdag 15:30-19:30 * Fredag 15:30-18:00"
  function readTrainingTimes() {
    var out = [];
    $$('.footer p, .footer li').forEach(function (p) {
      var m = txt(p).match(/^([A-Za-zÆØÅæøå0-9 ]{2,30}):\s*(.+)$/);
      if (!m) return;
      var name = m[1].trim(), segs = [];
      m[2].split(/\s\*\s|\s•\s|\s\|\s|;/).forEach(function (seg) {
        seg = seg.trim();
        var s = seg.match(/^(.+?)\s+(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})$/);
        if (!s) return;
        var days = parseDays(s[1]);
        if (!days.length) return;
        segs.push({ text: dash(seg), days: days, from: pad(s[2]) + ':' + s[3], to: pad(s[4]) + ':' + s[5] });
      });
      if (segs.length) out.push({ name: name, segs: segs });
    });
    return out;
  }
  function pad(h) { return (h.length < 2 ? '0' : '') + h; }
  function parseDays(s) {
    var res = [];
    s.toLowerCase().split(/\s*(?:&|,|\bog\b)\s*/).forEach(function (tok) {
      var r = tok.split(/\s*[-–]\s*/), a = DAYS.indexOf(r[0].trim()), b = r[1] ? DAYS.indexOf(r[1].trim()) : a;
      if (a < 0 || b < 0) return;
      for (var i = a; ; i = (i + 1) % 7) { if (res.indexOf(i) < 0) res.push(i); if (i === b) break; }
    });
    return res.sort();
  }
  function groupClass(name) {
    var n = name.toLowerCase();
    if (/^ungdom/.test(n)) return 'g-ungdom';
    if (/^senior/.test(n)) return 'g-senior';
    if (/^voksen/.test(n)) return 'g-voksen';
    if (/^veteran/.test(n)) return 'g-veteran';
    return 'g-andet';
  }
  function niceName(n) { return n.replace(/^VoksenFjer$/i, 'Voksenfjer').replace(/^Senior2$/i, 'Senior 2'); }

  // ---------- Hero ----------
  function hero() {
    var host = $('.container-banner');
    var banner = host && $('.banner-overlay', host);
    var badge = '', cardBig = '', cardSmall = '';
    if (banner) {
      badge = txt($('.overlay h1', banner));
      var sub = txt($('.overlay h2', banner)) || txt($('.overlay p', banner));
      var m = sub.match(/kåret som (.+?)\s+(af .+?)\.?$/i);
      if (m) { cardBig = cap(m[1]); cardSmall = 'Kåret ' + m[2]; } else { cardSmall = sub; }
    }
    if (!host) {
      host = el('div', { cls: 'container-banner full-width' });
      var grid = $('.site-grid'); if (!grid) return;
      grid.insertBefore(host, grid.firstChild);
    }
    var title = HB.heroTitle;
    if (!title) {
      var d = txt($('.container-header .site-description'));
      title = cap(d.replace(/^HØBK\s*[-–:]\s*/i, '')) || 'Her har vi det sjovt!';
    }
    var buttons = el('div', { cls: 'hb-actions' }, HB.heroButtons.map(function (b) {
      return el('a', { cls: 'hb-btn ' + (b.lime ? 'hb-btn-lime' : 'hb-btn-ghost'), href: b.href, text: b.text });
    }));
    var text = el('div', { cls: 'hb-hero-text' }, [
      badge ? el('p', { cls: 'hb-badge', text: badge }) : null,
      el('h1', { text: title }),
      HB.heroText ? el('p', { cls: 'hb-lead', text: HB.heroText }) : null,
      buttons
    ]);
    var media = el('div', { cls: 'hb-hero-media' });
    if (banner) {
      var ov = $('.overlay', banner); if (ov) ov.parentNode.removeChild(ov);
      banner.setAttribute('role', 'img');
      banner.setAttribute('aria-label', 'Foto fra klubben');
      media.appendChild(banner);
    } else media.appendChild(el('div', { cls: 'hb-hero-photo-empty', 'aria-hidden': 'true' }));
    if (cardBig || cardSmall) media.appendChild(el('div', { cls: 'hb-hero-card' }, [
      cardSmall ? el('span', { text: cardSmall }) : null, cardBig ? el('strong', { text: cardBig }) : null]));
    // andre moduler i banner-positionen (fx en <style>-modul) bliver liggende, skjult af layoutet
    host.classList.add('hb-hero-host');
    host.insertBefore(el('div', { cls: 'hb-wrap hb-hero' }, [text, media]), host.firstChild);
  }

  function section(id, kicker, title, link) {
    var head = el('div', { cls: 'hb-sec-head' }, [
      el('div', null, [kicker ? el('p', { cls: 'hb-kicker', text: kicker }) : null, el('h2', { text: title })]),
      link || null
    ]);
    return el('section', { cls: 'hb-sec', id: id }, [head]);
  }

  // ---------- Find dit hold ----------
  function teams(wrap, plan) {
    var cards = HB.groups.map(function (g) {
      var lines = [];
      plan.forEach(function (p) {
        if (!g.match.test(p.name)) return;
        var label = niceName(p.name) !== g.title ? niceName(p.name) + ': ' : '';
        lines.push(el('li', null, [label ? el('b', { text: label }) : null, p.segs.map(function (s) { return s.text; }).join(' · ')]));
      });
      return el('article', { cls: 'hb-card' + (g.lime ? ' is-lime' : '') }, [
        el('p', { cls: 'hb-kicker', text: g.kicker }),
        el('h3', { text: g.title }),
        el('ul', null, lines.length ? lines : [el('li', { text: 'Se træningstider på holdets side.' })]),
        el('a', { cls: 'hb-more', href: g.href, text: 'Læs mere' })
      ]);
    });
    var s = section('hb-hold', 'Bliv medlem', 'Find dit hold', el('a', { href: HB.signupHref, text: 'Tilmelding →' }));
    s.appendChild(el('div', { cls: 'hb-cards' }, cards));
    wrap.appendChild(s);
  }

  // ---------- Ugeplan ----------
  function week(wrap, plan) {
    if (!plan.length) return;
    var today = (new Date().getDay() + 6) % 7;
    var rows = DAYS_UC.map(function (day, i) {
      var items = [];
      plan.forEach(function (p) { p.segs.forEach(function (s) { if (s.days.indexOf(i) >= 0) items.push({ p: p, s: s }); }); });
      items.sort(function (a, b) { return a.s.from < b.s.from ? -1 : a.s.from > b.s.from ? 1 : 0; });
      var chips = items.length ? items.map(function (it) {
        return el('span', { cls: 'hb-chip ' + groupClass(it.p.name), text: niceName(it.p.name) + ' ' + it.s.from + '–' + it.s.to });
      }) : [el('span', { cls: 'hb-chip', text: 'Ingen fast træning' })];
      return el('div', { cls: 'hb-week-row' + (i === today ? ' is-today' : '') }, [
        el('span', { cls: 'hb-week-day', text: day }), el('div', { cls: 'hb-week-items' }, chips)]);
    });
    var seen = {}, legend = [];
    plan.forEach(function (p) {
      var c = groupClass(p.name); if (seen[c]) return; seen[c] = 1;
      var label = { 'g-ungdom': 'Ungdom', 'g-senior': 'Senior', 'g-voksen': 'Voksenfjer', 'g-veteran': 'Veteran' }[c] || niceName(p.name);
      var sw = el('i', { cls: 'hb-chip ' + c }); sw.style.padding = '0';
      legend.push(el('span', null, [sw, label]));
    });
    var s = section('hb-ugeplan', 'Fast træning', 'Ugeplan', el('a', { href: '/kalender', text: 'Hele kalenderen →' }));
    s.appendChild(el('div', { cls: 'hb-panel' }, [
      el('div', { cls: 'hb-legend', style: 'margin-bottom:12px' }, legend),
      el('div', { cls: 'hb-week' }, rows)
    ]));
    wrap.appendChild(s);
  }

  // ---------- Holdkampe (fra HØBK-appen) ----------
  function matches(wrap) {
    if (!HB.matchData || !window.fetch) return;
    var s = section('hb-holdkampe', 'Holdturnering · opdateres automatisk', 'Holdkampe',
      el('a', { href: HB.app, text: 'Alle hold i HØBK-appen →' }));
    s.hidden = true;
    wrap.appendChild(s);
    fetch(HB.matchData, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      var up = (d.upcoming || []).slice(0, 6), res = (d.results || []).slice(0, 6);
      if (!up.length && !res.length) return;
      var grid = el('div', { cls: 'hb-match-grid' });
      if (up.length) grid.appendChild(el('div', { cls: 'hb-panel' }, [
        el('h3', { text: 'Næste kampe' }),
        el('ul', { cls: 'hb-list' }, up.map(function (m, i) {
          return el('li', { cls: 'hb-row' + (i === 0 ? ' is-next' : '') }, [dateBox(m.date),
            el('div', { cls: 'hb-row-main' }, [
              el('strong', null, [link(m.url, m.team)]),
              el('span', { text: 'mod ' + m.opponent + ' · ' + weekday(m.date) + (m.time ? ' kl. ' + m.time : '') })]),
            el('span', { cls: 'hb-tag' + (m.home ? ' is-home' : ''), text: m.home ? 'Hjemme' : 'Ude' })]);
        }))]));
      if (res.length) grid.appendChild(el('div', { cls: 'hb-panel' }, [
        el('h3', { text: 'Seneste resultater' }),
        el('ul', { cls: 'hb-list' }, res.map(function (m) {
          var o = /^[VTU]$/.test(m.outcome) ? m.outcome : '';
          return el('li', { cls: 'hb-row' }, [dateBox(m.date),
            el('div', { cls: 'hb-row-main' }, [
              el('strong', null, [link(m.url, m.team)]),
              el('span', { text: (m.home ? 'hjemme mod ' : 'ude mod ') + m.opponent + (m.walkover ? ' · ' + m.walkover : '') })]),
            el('span', { cls: 'hb-score' }, [el('b', { text: m.result || '–' }),
              o ? el('span', { cls: 'hb-res ' + o, title: { V: 'Vundet', T: 'Tabt', U: 'Uafgjort' }[o], text: o }) : null])]);
        }))]));
      s.appendChild(grid);
      s.appendChild(el('p', { cls: 'hb-note', text: 'Kampe og resultater hentes automatisk fra badmintonplayer.dk' +
        (d.updated ? ' · opdateret ' + new Date(d.updated).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') + '.' }));
      s.hidden = false;
    }).catch(function () { /* ingen data → sektionen forbliver skjult */ });
  }
  function link(href, t) { return href ? el('a', { href: href, target: '_blank', rel: 'noopener', text: t }) : document.createTextNode(t); }
  function dt(iso) { return new Date(iso + 'T12:00:00'); }
  function weekday(iso) { return dt(iso).toLocaleDateString('da-DK', { weekday: 'long' }); }
  function dateBox(iso) {
    var d = dt(iso);
    return el('span', { cls: 'hb-date', 'aria-label': d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' }) }, [
      el('b', { text: String(d.getDate()) }), el('small', { text: d.toLocaleDateString('da-DK', { month: 'short' }).replace('.', '') })]);
  }

  // ---------- App ----------
  function appPromo(wrap) {
    if (!HB.app) return;
    var s = el('section', { cls: 'hb-sec' }, [el('div', { cls: 'hb-app' }, [
      el('div', null, [
        el('h2', { text: 'HØBK-appen' }),
        el('p', { text: 'Holdkampe, resultater, spillere, kalender og tilmelding til træning — samlet på mobilen. Tryk "Del" → "Føj til hjemmeskærm" for at gemme den som en app.' })]),
      el('a', { cls: 'hb-btn hb-btn-lime', href: HB.app, text: 'Åbn appen' })])]);
    wrap.appendChild(s);
  }

  // ---------- Forsideartiklen → kort ----------
  function blocks() {
    var body = $('main .com-content-article__body');
    if (!body || !$('hr', body)) return;
    var groups = [[]];
    Array.prototype.slice.call(body.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && n.tagName === 'HR') { n.parentNode.removeChild(n); groups.push([]); return; }
      groups[groups.length - 1].push(n);
    });
    var grid = el('div', { cls: 'hb-blocks' });
    groups.forEach(function (g) {
      if (!g.some(function (n) { return n.nodeType === 1 || txt(n); })) return;
      var b = el('section', { cls: 'hb-block' });
      g.forEach(function (n) { b.appendChild(n); });
      if ($('.carouselbanner, iframe, .fb-like-box, .table-row', b)) b.classList.add('is-wide');
      if ($('.carouselbanner', b)) b.classList.add('is-tinted');
      var h = $('h2, h3', b); if (h && /sponsor/i.test(txt(h))) b.classList.add('is-sponsors');
      grid.appendChild(b);
    });
    body.appendChild(grid);
    // karusellerne beregner bredde ved indlæsning — få dem til at måle igen
    setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }, 300);
  }

  // ---------- Footer ----------
  function footer() {
    var f = $('.footer .grid-child') || $('.footer');
    if (!f || $('.hb-foot-app', f)) return;
    if (HB.app) f.insertBefore(el('div', { cls: 'hb-foot-app' }, [
      el('div', null, [el('strong', { text: 'HØBK-appen' }), el('br'), 'Holdkampe, kalender og tilmelding på mobilen.']),
      el('a', { cls: 'hb-btn hb-btn-lime', href: HB.app, text: 'Åbn appen' })]), f.firstChild);
    f.appendChild(el('div', { cls: 'hb-foot-bottom' }, [
      el('span', { text: '© ' + new Date().getFullYear() + ' Hørsholm Badminton Klub' }),
      HB.privacyHref ? el('a', { href: HB.privacyHref, text: 'Privatlivspolitik' }) : null]));
  }
})();
