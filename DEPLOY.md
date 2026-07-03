# De app online zetten voor je vrienden (Railway)

Dit zet je app op een klein servertje dat altijd aan staat, met een net
webadres (met slotje, `https://...`). Je vrienden openen dat adres en kunnen het
op hun telefoon "installeren" als app. Kosten: ongeveer **€5 per maand**.

Je hoeft niks van programmeren te snappen. Volg gewoon de stappen.

> **Zonder wachtwoord:** iedereen met de link kan erin, en iedereen ziet
> dezelfde opgeslagen routes (een gedeeld routeboek). Dat is precies wat je
> koos. Wil je dat later dichtzetten met een wachtwoord, of er geld voor vragen?
> Dat kan er los bij; vraag het me gewoon.

---

## Wat je eenmalig nodig hebt

1. **Een Railway-account.** Ga naar https://railway.com, meld je aan (mag met je
   e-mail of met Google) en voeg bij _Account → Billing_ een creditcard toe.
   Railway rekent per gebruik af; voor deze app is dat rond de €5 per maand.

Dat is het enige waarvoor jij zelf even moet klikken. De rest hieronder zijn een
paar opdrachten die je in één zwart venster (de terminal) plakt — of laat mij ze
uitvoeren zodra jij bent ingelogd.

---

## Stap voor stap

Open een terminal in de map van de app (in de Verkenner: rechtsklik op de map
`RoutePlanner` → _Open in Terminal_), en voer deze uit, één voor één:

1. **Het Railway-programmaatje installeren** (eenmalig):

   ```
   npm install -g @railway/cli
   ```

2. **Inloggen** (dit opent je browser; klik op _Authorize_):

   ```
   railway login
   ```

3. **Een nieuw project aanmaken:**

   ```
   railway init
   ```

   Geef het een naam, bijvoorbeeld `routeplanner`.

4. **De app uploaden en laten bouwen:**

   ```
   railway up
   ```

   Dit duurt de eerste keer **een paar minuten**: Railway pakt je app in en haalt
   daarbij de 604 MB kaartdata van Nederland en België op. Laat het venster open
   tot het klaar is.

---

## Daarna, in het Railway-dashboard (https://railway.com)

Open je project in de browser. Nog drie kleine dingen:

5. **Opslag voor opgeslagen routes.** Klik je service aan → _Settings_ (of
   rechtsklik op de service) → _Add Volume_. Zet als koppelpad (_Mount path_)
   precies dit:

   ```
   /data
   ```

   Hierdoor blijven opgeslagen routes bewaard, ook als je later een nieuwe versie
   uploadt. (Sla je dit over, dan werkt de app ook, maar dan verdwijnen
   opgeslagen routes bij elke update.)

6. **Het webadres aanzetten.** Klik de service aan → _Settings → Networking_ →
   _Generate Domain_. Je krijgt een adres zoals
   `https://routeplanner-production.up.railway.app`. Dát is de link voor je
   vrienden.

7. Na het toevoegen van het volume herstart Railway de app even vanzelf. Wacht
   tot de service _Active_ (groen) is en open het adres. Klaar.

---

## Op de telefoon "installeren" als app

Stuur je vrienden de link. Op hun telefoon:

- **iPhone (Safari):** open de link → tik op het deel-icoon (vierkantje met
  pijltje omhoog) → _Zet op beginscherm_.
- **Android (Chrome):** open de link → menu (drie puntjes) → _App installeren_ /
  _Toevoegen aan startscherm_.

Er komt dan een icoontje op hun beginscherm dat de app schermvullend opent, net
als een echte app.

---

## Later een nieuwe versie online zetten

Heb je iets aangepast? Eén opdracht in de terminal in de app-map:

```
railway up
```

---

## Handig om te weten

- **Kaart heeft internet nodig.** De kaarttegels komen van OpenFreeMap; het
  routeren gebeurt op het servertje. Zonder internet zie je een net
  "geen internet"-schermpje.
- **Loopt het servertje uit z'n geheugen?** Zet dan in Railway bij _Variables_
  een variabele `BROUTER_XMX` op bijvoorbeeld `768M` (standaard is `1024M`).
- **Kosten in de gaten houden** kan in Railway onder _Usage_. Rond €5/maand voor
  normaal gebruik met een handvol mensen.
- **Geld vragen of een wachtwoord** willen we later? Laat het weten, dan bouw ik
  dat erin (bijvoorbeeld met Stripe voor betalen).

---

### Alternatief: via GitHub (voor als je automatische updates wilt)

Wil je dat elke wijziging vanzelf online komt, dan kun je de code op GitHub
zetten en Railway daaraan koppelen (_New Project → Deploy from GitHub repo_).
Dat vraagt een extra (gratis) GitHub-account. Voor nu is `railway up` simpeler;
zeg het als je liever de GitHub-route neemt, dan help ik je daarmee.
