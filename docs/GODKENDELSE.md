# Godkendelse af spillere og forældre — plan (forberedt, ikke slået til)

Status: koden ligger i `apps-script/Code.gs` (afsnittet *GODKENDELSE OG HOLDMEDLEMSKAB*) bag feature-flaget
`APPROVAL = { enabled: false, since: '', memberCheck: false, teamsFromLeaders: false }`. Intet ændrer sig, før et flag sættes til `true`
og der udgives en ny version. Appen (`index.html`) har endnu ingen skærme til det — se *Mangler i appen* nederst.

## Det gælder allerede nu (version 2026-11-01.5)

Alle der er med i et chatrum kan **læse**. Kun disse kan **skrive** (`canWrite_` i Code.gs — kontrolleres på serveren):

| Rolle | Må skrive |
|---|---|
| Administrator (inkl. hovedadministrator) | ja |
| Holdleder (udnævnt under Administration) | ja |
| Forælder (`p:`-login eller spiller med børn tilføjet) | ja |
| Spiller på mindst ét hold der ikke er ungdom (ikke `U…`) | ja |
| Ungdomsspiller (kun U-hold) | nej — ser *🔒 Ungdomsspillere kan læse med …* |
| Voksen uden hold (ingen holdkampe i år / nyt navn) | kun i chatten for sine **træningsgrupper** (ikke holdchat og ikke Ungdom) |

## 1. Godkendelse (`APPROVAL.enabled`)

**Flow**

1. En ny person logger ind som spiller eller forælder → `requestApproval_()` laver en række i fanen **Godkendelser** med status `afventer`.
   Administratorer springer det over. **Alle der havde logget ind før `APPROVAL.since`** (datoen hvor det slås til) er godkendt
   automatisk — kun nye skal godkendes.
2. Indtil godkendt kan personen se alt og læse chat, men **ikke skrive** (`canWrite_` returnerer *afventer*).
3. **Kun administratorer** ser listen (`action: pending`) og godkender/afviser (`action: approve`).
   Forældre godkendes **individuelt** af en administrator — medlemssystemet kender ikke forældrenes e-mails.
4. Hver beslutning er en ny række (hvem, hvornår, note), så historikken bevares.

**Fanen Godkendelser:** tidspunkt, email, playerId, navn, rolle (spiller/forælder), status (afventer/godkendt/afvist), note, behandletAf, behandlet.

## 2. Tjek mod medlemssystemet (`APPROVAL.memberCheck`)

Når en **spiller** opretter sig, slås e-mailen op i fanen **Medlemmer** (`isMember_`) — medlemmets egen e-mail fra Conventus.
Conventus har ikke forældrenes e-mails, så **forældre tjekkes ikke** mod medlemslisten; de godkendes individuelt af en administrator.

Står e-mailen **ikke** der:
- personen får en mail: *din e-mail står ikke i medlemssystemet — ret den (eller kontakt klubben), så kan profilen godkendes*;
- administratorerne (ikke hovedadministratoren) får en mail om det;
- anmodningen får noten *ikke i medlemssystemet*, og listen viser `member: false`, så admin kan se at det skal løses først.

**Fanen Medlemmer:** email, navn, medlemsnr, importeret. Fyldes ved at indsætte en **eksport fra Conventus**
(medlemsliste som CSV/Excel → kopiér kolonnerne ind). Opdatér den fx en gang om måneden.
*Senere:* hvis Conventus kan levere en automatisk eksport (fil-link eller API), kan et GitHub-workflow eller Apps Script hente den.
Persondata bliver i Google — kommer aldrig i GitHub.

## 3. Holdlederne bestemmer holdene (`APPROVAL.teamsFromLeaders`)

I dag kommer holdenes spillere fra badmintonplayer.dk (dem der har spillet), og spillerne vælger selv træningsgrupper.
Med flaget slået til styres det af **fanen Holdmedlemmer**, som kun holdlederne kan ændre (`action: groupMember`):

| Gruppe | Hvem må ændre |
|---|---|
| Et hold (`h:<holdId>`) | holdlederne for holdet + administratorer |
| En træningsgruppe (`g:Ungdom`, `g:Senior` …) | holdledere for et hold i samme aldersgruppe (U-hold → Ungdom, MOT → Voksenfjer, A-række → Veteran, øvrige → Senior/Senior2) + administratorer |

Chatrum og "Mine hold" følger så listen: man er med i holdets chat, hvis holdlederen har sat én på holdet (eller ens barn),
og i en træningsgruppes chat, hvis man er sat i gruppen. *Følger holdet* giver stadig adgang til at læse.

**Fanen Holdmedlemmer:** playerId, navn, gruppe, tilføjetAf, tidspunkt.

## Mangler i appen (bygges når I vil slå det til)

- **Administration → Godkendelser:** liste over afventende (navn, rolle, *ikke i medlemssystemet*), knapper *Godkend* / *Afvis* med note.
- **Holdleder-fanen → Holdets spillere:** søg spiller, tilføj/fjern på holdet og i træningsgruppen (bruger `groupMember`).
- **Min side:** gult kort *Din profil afventer godkendelse* (+ *ret din e-mail i medlemssystemet* når det er årsagen).
- Første gang: kør `setup` (opretter fanerne Medlemmer, Godkendelser, Holdmedlemmer — det sker allerede fra version 2026-11-01.4),
  indsæt medlemslisten, og lad holdlederne fylde deres hold, **før** `teamsFromLeaders` slås til — ellers er holdchattene tomme.

## Beslutninger (1. nov 2026)

1. Eksisterende brugere godkendes automatisk — sæt `APPROVAL.since` til den dag det slås til.
2. Kun administratorer godkender — spillere og forældre.
3. Conventus har ikke forældres e-mails → forældre godkendes individuelt af en administrator; spillere tjekkes mod medlemmets egen e-mail.

## Stadig åbent

- Ungdomsspillere er ofte registreret i Conventus med en forælders e-mail. Logger barnet ind med sin egen e-mail, matcher den ikke —
  administratoren må så godkende manuelt (mailen fortæller hvad der skal rettes).
