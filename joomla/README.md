# HØBK-skabelon til hoebk.dk (Joomla)

Nyt look til hjemmesiden efter designforslaget "HØBK Redesign": mørkeblå header og footer, lime knapper,
Archivo/Inter-skrift og en ny forside. Det er et **undertema (child template) af Cassiopeia** — Joomlas
standardskabelon, som hoebk.dk allerede bruger. Det ændrer kun udseendet: artikler, menuer, moduler og
billeder er uændrede, og man kan altid skifte tilbage med ét klik.

**Fil:** `tpl_cassiopeia_hoebk.zip` (i denne mappe)
**Kræver:** Joomla 4.1 eller nyere (hoebk.dk kører 4.4.0) — virker også på Joomla 5.

## Installér (ændrer ikke noget for de besøgende)

1. Log ind på administrationen: `https://hoebk.dk/administrator`
2. **Systemet → Installer → Udvidelser** → fanen **Upload pakkefil** → træk `tpl_cassiopeia_hoebk.zip` ind.
   Der kommer en grøn besked "Installation af skabelon gennemført".
3. **Systemet → Site-skabelonstile**. Her står nu både *Cassiopeia - Default* (★ = den der bruges) og
   *cassiopeia_hoebk - Default*. Notér **ID** for den nye (kolonnen længst til højre).

## Se det nye look først

Åbn forsiden med stil-ID'et bag på adressen, fx `https://hoebk.dk/?templateStyle=12`
(brug det ID du noterede). Kun den side du åbner på den måde vises i det nye look — alle andre ser stadig
den gamle side. Prøv også på mobilen.

## Slå det til

**Systemet → Site-skabelonstile** → klik på **☆** ud for *cassiopeia_hoebk - Default*, så den bliver
standard (★). Tryk evt. Ctrl+F5 / genindlæs på mobilen.

**Fortryd:** klik ★ ud for *Cassiopeia - Default* igen. Det gamle look er tilbage med det samme.

## Hvor kommer indholdet fra?

| Sektion på forsiden | Rettes her |
|---|---|
| Hero: mærkat "Årets klub på Sjælland 2023", kort på billedet, baggrundsfoto | Banner-modulet (Indhold → Site-moduler, positionen *banner*): overskrift, undertekst og baggrundsbillede |
| Hero: "Her har vi det sjovt!" | Skabelonstilen → fanen *Avanceret* → *Sidebeskrivelse* |
| Find dit hold + Ugeplan | Træningstiderne i footer-modulet ("Ungdom: Mandag 15:30-19:15 * …") — ret tiderne dér, så følger forsiden med |
| Holdkampe (næste kampe og seneste resultater) | Automatisk fra badmintonplayer.dk via HØBK-appen (`data/hjemmeside.json`, opdateres dagligt og hver halve time på kampdage) |
| Nyheder, aktiviteter, kort, sponsorer, billeder | Forsideartiklen som hidtil — hver vandret linje (`<hr>`) bliver til et kort |
| Logo | Skabelonstilen → *Logo* (hvid udgave er sat på som standard) |

Faste tekster (heroteksten, knapperne, overskrifterne på holdkortene, link til appen) står øverst i
`user.js`: **Systemet → Site-skabeloner → Cassiopeia_hoebk Details and Files → media → js → user.js**.

Uden JavaScript (eller hvis noget fejler) vises siden stadig — med de nye farver og skrifter, bare uden de
nye forsidesektioner.

## Tekniske noter

- Filer: `templateDetails.xml` (kopi af Cassiopeias indstillinger + `<parent>cassiopeia</parent>`),
  `media/css/user.css`, `media/js/user.js`, `media/fonts/*` (Archivo og Inter, SIL OFL 1.1), `media/images/logo-hoebk.png`.
  Cassiopeia indlæser selv `user.css` og `user.js` fra undertemaet — ingen PHP-filer.
- Skrifterne ligger lokalt → ingen Google Fonts og ingen cookies/ekstra samtykke.
- hoebk.dk har et modul i banner-positionen med en `<style>`-blok (gule/vinrøde farver, hvid header).
  `user.css` skriver `html body …` foran sine regler, så de vinder over den. Den gamle blok kan blive liggende.
- Ny version: hæv `<version>` i `templateDetails.xml`, kør `python tools/build_template.py`, og upload zip'en
  igen — Joomla opdaterer skabelonen og beholder stilens indstillinger.
- Testet på en ren Joomla 4.4.0 med samme menu, banner-, stil- og footer-moduler og forsideartikel som hoebk.dk
  (desktop 1280/1440 px og mobil 390 px, dropdown- og burgermenu).
