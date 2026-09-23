# Intent‑taal — specificatie v0.1

Een taal om te beschrijven **wat iets moet zijn**, zodat een bouwer (mens of model) er code van kan maken die tien keer vrijwel dezelfde applicatie oplevert. Code is een wegwerpafgeleide; de spec is de bron.

Status: ontwerp, nog niet gemeten. Zie §12 voor de test die dit ontwerp moet doorstaan.

---

## 1. Principes

1. **Wat, nooit hoe.** De taal kent geen implementatiebegrippen. Uiterlijk, paden, JSON‑vorm en modelkeuze komen uit profielen en worden afgeleid.
2. **Bewijs is onderdeel van de spec.** Elk gedrag dat telt staat in een scenario. Wat geen scenario heeft is niet bewezen; de linter zegt dat.
3. **Tekst is een type.** Eisen en doelen zijn zinnen, maar zinnen met ankers naar gedeclareerde symbolen. Overal waar exactheid telt (referenties, waarden, scenario's) is het syntax.
4. **Gesloten vocabulaires.** Werkwoorden, elementen, layouts en effecten komen uit het register. Onbekend = fout, nooit een gok.
5. **Compositie op naam, versies in de lockfile.** De bron noemt namen; `ouros.lock` pint versies. Een pin wijzigt nooit stilletjes.
6. **Bouw is een pure functie.** `build(spec, profiel, contracten) → code`. Hergebruik is een cache‑hit, nooit een bron van waarheid. Alle code moet op elk moment uit alle specs opnieuw te genereren zijn.
7. **Klein.** 15 keywords, één blokvorm, één statementvorm. Groei komt uit het register (kinds, types, werkwoorden), niet uit de grammatica.

---

## 2. Bestanden en packages

- Extensie: `.intent`. Eén of meer units per bestand.
- Elk bestand begint met `package <qname>`.
- `package.ouros` (per package): defaults voor `targets` en `profile`. Een unit overschrijft die alleen bij afwijking.
- `ouros.lock` (per package, gegenereerd, gecommit): pin per geïmporteerde naam op `<registry-id>@<versie>` plus inhoudshash.

```
sjors/
  package.ouros
  ouros.lock
  jascheck.intent
  ochtenddashboard.intent
```

```toml
# package.ouros
[defaults]
targets = ["web", "terminal"]
profile = "std.Design"
```

```toml
# ouros.lock  (gegenereerd)
[refs]
"std.weather.Today"   = { id = "std/weather-today", version = 2, sha = "4f1e…" }
"std.calendar.Today"  = { id = "std/calendar-today", version = 2, sha = "9ab0…" }
"sjors.Jascheck"      = { id = "sjors/jascheck", version = 3, sha = "c77d…" }

[slots]
"sjors.Ochtenddashboard.taken" = "unresolved"   # policy: approval
```

---

## 3. Lexicaal

| Token | Vorm | Voorbeeld |
|---|---|---|
| Ident | `[A-Za-z][A-Za-z0-9]*` | `advice`, `Jascheck` |
| qname | `Ident("." Ident)*` | `std.weather.Today` |
| string | `"…"` met `\"` escape | `"koud en nat"` |
| boundtext | string waarin `{Ident}` een anker is | `"Toont {advice}."` |
| number | `-?[0-9]+(\.[0-9]+)?` | `15`, `12.5` |
| unit | direct achter number, uit het register | `15°C`, `40min`, `07:00`, `1h` |
| doc | `///` tot regeleinde; hoort bij de volgende declaratie | `/// Onder deze temperatuur: jas mee.` |
| comment | `//` tot regeleinde | |
| scheider | newline of `;` | |

Whitespace en indentatie zijn niet betekenisvol. Een canonieke formatter bepaalt de opmaak; de LLM ziet altijd dezelfde bytes voor dezelfde spec.

---

## 4. Keywords (15 + 6 kinds)

```
package import as
needs dial shows in out effect layout requires scenario given when then free example
data enum
```

Kinds (keywords die een unit openen): `widget` `tool` `job` `agent` `api` `contract`.

Alles wat hier niet staat is een identifier of komt uit het register.

---

## 5. Units

```
/// doc
<kind> Ident {
    member*
}
```

| Kind | Wat het is | Bewijsmiddel | Eigen werkwoorden (`when`) |
|---|---|---|---|
| `widget` | iets met een zichtbaar oppervlak | `shows`‑elementen | `load`, `tap(x)`, `type(x, "…")`, `advance(duur)` |
| `tool` | één aanroepbare eenheid | `out` | `call(args)` |
| `job` | een tool met schedule, headless | `out`, `asked` | `clock(tijd)`, `answer(naam, waarde)` |
| `agent` | orkestreert tools via een model | `shows`, tool‑aanroepen | `say("…")`, `confirm`, `deny` |
| `api` | stelt tools bloot over een transport | de tools | `call` per rol |
| `contract` | de vorm van data die de grens over gaat | `example` | — |

Daarnaast: `data Ident { veld* }` en `enum Ident { Waarde* }` als in Kotlin.

Een kind bepaalt welke members zijn toegestaan en welke werkwoorden `self` en `user` hebben. Nieuwe kinds komen uit het register; de grammatica verandert niet.

---

## 6. Members

Eén declaratievorm: `keyword naam[: type][= default] [/// doc]`.

| Member | Betekenis | Toegestaan in |
|---|---|---|
| `needs x: T` | afhankelijkheid van buiten: contract, component, tool | alle |
| `needs x = Ctor(args)` | concreet gevulde afhankelijkheid (slot met binding); args zijn dials van `Ctor` | widget, agent, api |
| `needs x: shows T` | structureel slot: alles dat `T` toont | widget |
| `dial x: T = v` | instelbaar door eindgebruiker, zonder herbouw | alle |
| `shows x: T` | betekenisvol getoond element, type uit profiel | widget, agent |
| `in x: T` | invoer | tool, job, api |
| `out x: T` | uitvoer | tool, job, agent |
| `effect E<T>` | neveneffect: `Pure`, `Reads<T>`, `Writes<T>`, `Sends<T>` | tool, job |
| `layout L { a; b }` | gesloten layout uit profiel, genest toegestaan | widget |
| `requires "… {x} …"` | eis als tekst met ankers | alle |
| `scenario "…" { … }` | bewijs | alle |
| `free pad` | bewust vrijgelaten aspect | alle |
| `example "…" = expr` | voorbeeldwaarde (contract) | contract |

Regels:
- Dial‑type mag worden afgeleid uit de default (`dial threshold = 15°C` → `Temperature`).
- Een `needs` met `=` bindt dials via named arguments; een onbekende dial of verkeerd type is een compilefout.
- `free` verwijst naar een pad op een `shows`/`out`‑element, bv. `free advice.wording`. Aspecten per type staan in het register.

---

## 7. Het tekst‑type (`requires`)

```
requires "Toont {advice} in één oogopslag, groter dan {temp} en {condition}."
```

- Elke `{naam}` bindt aan een member van de unit of een geïmporteerde naam. Onbekend = compilefout.
- De zin zelf is voor mens en model. De ankers zijn voor de linter: welke elementen hebben een eis, welke eis heeft een scenario dat de gebonden elementen raakt.
- `requires` zonder ankers is toegestaan maar geeft een lint‑warning (`unanchored requirement`).
- Provenance (`human`/`ai`) is registermetadata per regel, niet syntax.

---

## 8. Scenario's

```
scenario "naam" {
    given <toewijzing | pad>
    when  <werkwoord | toewijzing>
    then  <expr == expr | expr != expr>
}
```

- `given` zet de wereld: `given weather = Today(temp = 12°C, condition = Rain)`, `given taken.lapsed`.
- `when` doet iets: een werkwoord van de kind (`load`, `call(les)`, `say("…")`) of een toewijzing (= een event op een `needs`).
- `then` meet: uitsluitend `==` en `!=` op paden, literals en constructors. Geen operatoren, geen logica; wat je zo niet kunt zeggen zeg je als extra scenario met concrete waarden.
- Volgorde is betekenisvol; `when`/`then` mogen afwisselen.
- Vaste meetpaden per kind: widget `interactions`, tool `rejected`, job/agent `asked`, agent `<Tool>.calls`.

Compileert 1:1 naar het bestaande `TestDocument` (`GivenClause`, `WhenStep`, `ThenStep`). Een stap die de runner niet kent bestaat in de taal niet.

---

## 9. Contracten en data

```
package std.weather

/// Het weer van dit moment op de locatie van de gebruiker.
contract Today {
    temp: Temperature
    condition: Condition
    rainEndsIn: Duration?

    changes atLeastEvery 15min

    example "regen met einde" = Today(temp = 12°C, condition = Rain, rainEndsIn = 40min)
}

enum Condition { Sun, Cloudy, Rain, Snow }
```

- Een contract compileert naar het huidige contract‑artefact (`params`/`schema`/`examples`); niemand schrijft de JSON.
- Contracten voor eigen data worden **afgeleid** uit `data`, `in`, `out` en `shows`; alleen de buitenwereld (weer, mail, agenda) heeft handgeschreven contracten.
- Evolutie bij een nieuwe versie: veld toevoegen met default of `?` = additief; veld verwijderen of verplicht maken = breaking (nieuwe major, gebruikers krijgen een proposal). De compiler classificeert het diff op het artefact, niet op de tekst.
- Opgeslagen data overleeft rebuilds. Een breaking `data`‑wijziging genereert een migratie (`was`, defaults, `deprecated`), dry‑runt hem tegen een snapshot en vraagt om één menselijke goedkeuring bij dataverlies.

Types uit `std`: `Text`, `Int`, `Decimal`, `Bool`, `DateTime`, `Duration`, `Temperature`, `Ref<T>`, `List<T>`, `T?`. Eenheden horen bij typen (`°C`, `min`, `h`, `hh:mm`).

---

## 10. Versies, refinement, register

- Een unit in het register heet `<package>/<naam>@<n>`. `@n` wordt door het register toegekend bij publiceren van een gewijzigde inhoudshash; je schrijft hem nooit in bron.
- Refinement = nieuwe versie van dezelfde naam. Toegestaan: members, eisen, scenario's toevoegen; `free` verkleinen. Niet toegestaan: een `requires` of `shows` verwijderen, een dial‑type wijzigen. Dat maakt upgrades mechanisch veilig.
- Register‑metadata per versie: aantal scenario's, state‑matrix‑dekking, convergentiescore, aantal gebruikers. `needs x: shows T` wordt opgelost op volwassenheid, niet op recency.
- Provenance per eis (`human`/`ai`) en het `unmet`‑mechanisme uit openouros blijven bestaan als registerdata en compileresultaat.

---

## 11. Lint (verplicht, onderdeel van de compiler)

| Code | Wanneer |
|---|---|
| `UNPROVEN_ELEMENT` | `shows`/`out` komt in geen enkel `then` voor en staat niet in `free` |
| `UNANCHORED_REQUIREMENT` | `requires` zonder `{anker}` |
| `REQUIREMENT_WITHOUT_SCENARIO` | geen scenario raakt een van de ankers van de eis |
| `SLOT_NEVER_EXERCISED` | `needs` slot komt in geen scenario voor |
| `UNCOVERED_STATE` | state‑matrix (empty, loading, error, lapsed, denied) heeft geen scenario voor een element |
| `UNKNOWN_VERB` | werkwoord bestaat niet op de kind of het type (met suggestie) |
| `WRITE_WITHOUT_APPROVAL` | agent gebruikt tool met `Writes`/`Sends` zonder scenario dat `asked` bewijst |
| `UNRESOLVED_SLOT` | lockfile heeft `unresolved` voor een slot met policy `auto` |

Warnings zijn de iteratie‑backlog: precisie groeit waar de compiler erom vraagt.

---

## 12. De test die dit moet doorstaan

```
ouros converge sjors.Jascheck --builds 10
  scenarios      6/6 pass in 10/10 builds
  state matrix   9/11 cells covered
  differential   2 divergences on `shows`-waarden bij gefuzzde inputs
     condition: leeg bij Cloudy in 3/10 builds   → UNCOVERED_STATE
     temp: afronding verschilt                    → profielgat of dial
```

Procedure:
1. Bouw elke unit N keer (temperature 0, canonieke serialisatie).
2. Draai alle scenario's tegen elke build.
3. Fuzz inputs vanuit `contract`‑examples en dials; vergelijk `shows`/`out`‑waarden over builds.
4. Elke divergentie is een ontbrekend scenario, een profielgat, of een bewuste `free`.

Eerste testset: de vier units in §14. Pas na meting wordt de taal gewijzigd.

---

## 13. Grammatica (EBNF, kern)

```ebnf
file       = "package" qname import* unit* ;
import     = "import" qname ["as" Ident] ;
unit       = doc* (kindunit | dataunit | enumunit) ;
kindunit   = kind Ident "{" member* "}" ;
kind       = "widget" | "tool" | "job" | "agent" | "api" | "contract" ;
dataunit   = "data" Ident "{" field* "}" ;
enumunit   = "enum" Ident "{" Ident ("," Ident)* "}" ;
field      = doc* Ident ":" type ["=" expr] ;

member     = doc* ( "needs" binding
                  | "dial" binding
                  | "shows" Ident ":" type
                  | "in" Ident ":" type
                  | "out" Ident ":" type
                  | "effect" type
                  | "layout" Ident "{" layoutitem* "}"
                  | "requires" boundtext
                  | "free" path
                  | "example" string "=" expr
                  | "changes" Ident expr                (* alleen contract *)
                  | scenario ) ;
binding    = Ident ( ":" type ["=" expr] | "=" expr | ":" "shows" type ) ;
layoutitem = Ident | "layout" Ident "{" layoutitem* "}" ;

scenario   = "scenario" string "{" step* "}" ;
step       = "given" (assign | path)
           | "when"  (call | assign)
           | "then"  expr ("==" | "!=") expr ;
assign     = path "=" expr ;
call       = Ident ["(" args ")"] ;

expr       = literal | path | ctor | list ;
ctor       = qname "(" [args] ")" ;
args       = arg ("," arg)* ;
arg        = [Ident "="] expr ;
list       = "[" [expr ("," expr)*] "]" ;
path       = qname ;
type       = qname ["<" type ("," type)* ">"] ["?"] ;
literal    = number [unit] | string | "true" | "false" | "null" ;
boundtext  = '"' (text | "{" Ident "}")* '"' ;
qname      = Ident ("." Ident)* ;
```

Tokenklassen voor highlighting (`highlights.scm`): `keyword`, `kind`, `type`, `member`, `verb`, `enum.value`, `literal`, `anchor` (`{x}` in boundtext), `doc`, `comment`.

---

## 14. Testset

### 14.1 `sjors/jascheck.intent`

```
package sjors

import std.weather.Today

/// In één oogopslag zien of er vandaag een jas mee moet.
widget Jascheck {
    needs weather: Today

    dial threshold: Temperature = 15°C   /// Onder deze temperatuur: jas mee.
    dial tone: Tone = Nuchter

    shows advice: Advice
    shows temp: Temperature
    shows condition: Condition

    requires "Toont {advice} in één oogopslag, groter dan {temp} en {condition}."
    requires "Werkt {advice} bij zonder herladen wanneer {weather} verandert."

    scenario "koud en nat" {
        given weather = Today(temp = 12°C, condition = Rain)
        when  load
        then  advice == Yes
        then  temp == 12°C
        then  condition == Rain
    }

    scenario "warm en droog" {
        given weather = Today(temp = 18°C, condition = Sun)
        when  load
        then  advice == No
    }

    scenario "op de drempel" {
        given weather = Today(temp = 15°C, condition = Cloudy)
        when  load
        then  advice == No
    }

    scenario "werkt zich bij zonder herladen" {
        given weather = Today(temp = 12°C, condition = Rain)
        when  load
        when  weather = Today(temp = 20°C, condition = Sun)
        then  advice == No
        then  interactions == 0
    }

    scenario "geen weer beschikbaar" {
        given weather.unavailable
        when  load
        then  advice == Unknown
    }

    free advice.wording
}

enum Tone { Nuchter, Vrolijk }
```

### 14.2 `sjors/ochtenddashboard.intent`

```
package sjors

import std.calendar.Today as Agenda
import std.tasks.Task

/// Bij het opstaan alles zien wat vandaag telt.
widget Ochtenddashboard {
    needs jas    = Jascheck(tone = Vrolijk)
    needs agenda = Agenda(compact = true)
    needs taken: shows List<Task>

    layout Stack { jas; agenda; taken }

    requires "Toont {jas}, {agenda} en {taken} onder elkaar, in die volgorde."

    scenario "alles laadt" {
        given jas.resolved
        given agenda.resolved
        given taken.resolved
        when  load
        then  jas.visible == true
        then  agenda.visible == true
        then  taken.visible == true
    }

    scenario "vervallen slot toont lege staat" {
        given taken.lapsed
        when  load
        then  taken == Empty
        then  jas.visible == true
    }
}
```

### 14.3 `std/weather/today.intent`

```
package std.weather

/// Het weer van dit moment op de locatie van de gebruiker.
contract Today {
    temp: Temperature
    condition: Condition
    rainEndsIn: Duration?

    changes atLeastEvery 15min

    example "koud en nat"      = Today(temp = 12°C, condition = Rain)
    example "regen met einde"  = Today(temp = 12°C, condition = Rain, rainEndsIn = 40min)
    example "zomer"            = Today(temp = 28°C, condition = Sun)
}

enum Condition { Sun, Cloudy, Rain, Snow }
```

### 14.4 `sjors/boekingen.intent`

```
package sjors

import std.identity.Current

data Les {
    titel: Text
    start: DateTime
    plekken: Int
}

data Boeking {
    les: Ref<Les>
    status: Status = Open
}

enum Status { Open, Bevestigd, Geannuleerd }

/// Alle lessen van komende week.
tool ZoekLessen {
    out lessen: List<Les>
    effect Reads<Les>

    scenario "leeg" {
        given Les.all = []
        when  call
        then  lessen == []
    }
}

/// Eén les boeken voor de huidige klant.
tool BoekLes {
    needs klant: Current
    in   les: Ref<Les>
    out  boeking: Boeking
    effect Writes<Boeking>

    requires "Weigert wanneer {les} vol is."

    scenario "vol is vol" {
        given les = Les(plekken = 1)
        given Boeking.all = [Boeking(les = les, status = Bevestigd)]
        when  call(les)
        then  rejected == Conflict
    }

    scenario "plek vrij" {
        given les = Les(plekken = 2)
        given Boeking.all = [Boeking(les = les, status = Bevestigd)]
        when  call(les)
        then  boeking.status == Bevestigd
    }
}

/// Helpt een klant een passende les kiezen en boeken.
agent BoekingsAgent {
    needs ZoekLessen
    needs BoekLes
    shows boeking: Boeking?

    requires "Roept {BoekLes} nooit aan zonder bevestiging van de gebruiker."

    scenario "boekt na bevestiging" {
        given ZoekLessen.returns = [Les(titel = "Yoga")]
        when  say("Ik wil morgen yoga")
        then  asked == BoekLes
        when  confirm
        then  BoekLes.calls == 1
        then  boeking != null
    }

    scenario "boekt niet zonder bevestiging" {
        given ZoekLessen.returns = [Les(titel = "Yoga")]
        when  say("Boek maar wat")
        then  BoekLes.calls == 0
    }
}
```

---

## 15. Open beslissingen (vastzetten na de eerste meting)

1. `then` alleen `==`/`!=`, of ook `in`, `<`, `>` voor numerieke drempels.
2. Of `requires` verplicht minstens één anker moet hebben (nu: warning).
3. Welke layouts en state‑waarden `std.Design` precies aanbiedt (gesloten set).
4. Of `api` een eigen kind blijft of een `profile` op een set tools.
5. Naamgeving: `needs` voor zowel contract als slot, of splitsen zodra dat verwarrend blijkt.

---

## 16. Mapping naar openouros

| Taal | openouros |
|---|---|
| `widget`/`tool`/`job`/`agent` | `Intent` + `Target` (web/terminal/headless) |
| `requires` | `Requirement` (+ provenance in register) |
| `scenario` | `Scenario` → `TestDocument` |
| `needs x = …` / `needs x: shows T` | `Slot` (intent‑gebonden / requirement‑gebonden), `Binding` |
| `dial` | slot `props` (nu getypeerd) |
| `contract` | `Contract` (params/schema/examples afgeleid) |
| `ouros.lock` | gepinde contract‑ en componentversies |
| `free` | nieuw |
| lint‑codes | nieuw, naast `Gate`/`CodeCheck` |
