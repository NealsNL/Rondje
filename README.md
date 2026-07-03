# Routeplanner

Een lokale webapp om fietsroutes te tekenen en te bewerken op een kaart (zoals
Komoot), een rondrit te genereren vanaf een startpunt + richting + afstand,
te kiezen tussen **verhard** en **onverhard**, routes op te slaan en een
**GPX** te exporteren voor je Garmin Edge 540.

Alles draait lokaal op je eigen PC. Geen account, geen internetdiensten die
geld kosten, geen API-sleutels. De kaarttegels komen gratis van OpenFreeMap;
het routeren gebeurt volledig offline op je eigen computer.

---

## Wat er onder de motorkap zit (kort)

Er zijn twee onderdelen die tegelijk draaien:

1. **De routeserver (BRouter)** – rekent de echte fietsroutes uit over de wegen,
   met hoogtemeters, en maakt de GPX. Draait als een klein Java-programma. De
   benodigde Java is meegeleverd in de map `brouter/jre`, dus je hoeft zelf
   niets te installeren.
2. **De webapp (Next.js)** – de kaart en de knoppen die je in de browser ziet.

De browser praat nooit rechtstreeks met de routeserver; dat gaat via de webapp.

> **Waarom geen Docker?** Het plan noemde Docker, maar we draaien BRouter als
> los Java-programma met een meegeleverde Java-runtime. Dat is gratis zonder
> enige licentievraag, lichter voor je PC en met minder dat stuk kan gaan —
> precies wat "gratis en soepel" vraagt. Het resultaat (de routes) is identiek.

---

## Eén keer instellen

Je hebt alleen **Node.js** nodig (versie 18 of nieuwer). Check in een terminal:

```
node --version
```

Staat Node er nog niet? Download de LTS-versie van https://nodejs.org en
installeer die (standaard instellingen zijn prima).

Installeer daarna de onderdelen van de app. Open een terminal in deze map en
voer uit:

```
npm install
```

Dat is alles. De kaartdata (Nederland + België) en de Java-runtime staan al in
de map `brouter/`.

---

## Starten (de makkelijke manier)

Dubbelklik op **`start.bat`**.

Er openen twee zwarte vensters (de routeserver en de app) en na een paar
seconden opent je browser op http://localhost:3000. Klaar.

Stoppen doe je door die twee vensters te sluiten.

### Starten (handmatig, als je liever de terminal gebruikt)

Open twee terminals in deze map:

- Terminal 1 – de routeserver:
  ```
  npm run brouter
  ```
- Terminal 2 – de webapp:
  ```
  npm run dev
  ```
- Ga daarna naar http://localhost:3000

---

## Hoe je de app gebruikt

- **Startpunt:** klik op de kaart.
- **Eindpunt:** klik nog een keer (mag hetzelfde zijn als de start voor een
  rondje).
- **Route bijschaven:** sleep een punt om het te verplaatsen, of klik op de
  blauwe lijn om er een nieuw punt tussen te zetten en sleep dat op zijn plek.
- **Punt verwijderen:** rechtsklik op een punt.
- **Afstand:** staat altijd linksboven in beeld en verandert live mee.
- **Nieuwe route:** wist alles zodat je opnieuw kunt beginnen.

### Voor op de fiets

- **Ondergrond in kleur:** de route is groen waar hij verhard is, geel bij
  halfverhard (stevig grind) en oranje waar hij onverhard wordt. Eronder zie je
  het percentage verhard / half / onverhard — zo weet je vooraf waar je van het
  asfalt af gaat.
- **Rijtijd:** vul bij "km/u gemiddeld" je eigen snelheid in; de tijd rekent
  daarmee. Je snelheid wordt onthouden.
- **Klim, daling en steilste stuk:** staan naast de tijd.
- **Hoogteprofiel:** beweeg met je muis over de grafiek — je ziet de hoogte,
  afstand en het stijgingspercentage op dat punt, en een stip op de kaart laat
  precies zien waar je bent.
- **Omdraaien:** rijdt hetzelfde rondje de andere kant op.
- **GPX importeren:** laad een bestaande route in om hem aan te passen en opnieuw
  te exporteren.

---

## Kaartdata (segmenten)

Het routeren gebruikt "segmentbestanden" (`.rd5`) met de wegen. Voor Nederland
en België staan deze vier tegels in `brouter/segments4/`:

| Bestand      | Dekt                                                        |
| ------------ | ----------------------------------------------------------- |
| `E0_N50.rd5` | West-NL en West/Midden-België                               |
| `E5_N50.rd5` | Oost-NL (o.a. Limburg, Twente) en Oost-België (o.a. Luik)   |
| `E0_N45.rd5` | Zuid-België onder 50° breedte (westelijk deel)              |
| `E5_N45.rd5` | Zuidoost-België (Ardennen, provincie Luxemburg)             |

De twee `*_N45`-tegels zijn er puur voor het zuiden van België (de Ardennen).
Fiets je daar nooit? Dan mag je die twee bestanden verwijderen om ~375 MB
schijfruimte te besparen; de rest van NL/BE blijft gewoon werken.

De data komt van https://brouter.de/brouter/segments4/. Kwijt of updaten?
Zie het script `scripts/download-brouter.ps1`.

---

## De profielen aanpassen (verhard / onverhard)

De twee routeprofielen staan als leesbare tekstbestanden in
`brouter/profiles2/`:

- **`paved.brf`** (Verhard) – gebaseerd op BRouter's `trekking`, maar vermijdt
  onverharde wegen sterk. Bovenin het bestand staat één knop, `unpaved_penalty`,
  die je hoger kunt zetten om onverhard nóg meer te mijden.
- **`unpaved.brf`** (Onverhard) – gebaseerd op BRouter's `gravel`, met de
  voorkeur voor onverhard (`prefer_unpaved_paths`) standaard aangezet.

Na een wijziging: stop de routeserver (venster sluiten) en start hem opnieuw.

---

## Mappenoverzicht

```
brouter/
  brouter-1.7.9-all.jar   de routemotor (Java)
  jre/                    meegeleverde Java-runtime
  segments4/              kaartdata (.rd5) voor NL + BE
  profiles2/              routeprofielen, incl. paved.brf en unpaved.brf
  customprofiles/         (leeg, door BRouter gebruikt)
app/                      de webapp (pagina's en API)
components/               de kaartcomponent
lib/                      hulpcode (coördinaten, BRouter-client, geometrie)
scripts/                  start- en downloadscripts
data/                     hier komt de database met opgeslagen routes
```

---

## Problemen oplossen

- **"Routeserver niet bereikbaar" in de app:** het routeserver-venster is niet
  (meer) open. Start `start-brouter.bat` of `npm run brouter` opnieuw.
- **De kaart blijft leeg:** controleer je internetverbinding (de kaart­tegels
  komen van OpenFreeMap). Het routeren zelf werkt wél offline.
- **"Een van de punten ligt te ver van een weg":** zet het punt dichter op een
  (fiets)weg.
