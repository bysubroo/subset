# SubSet v0.1

SubRoo-ov alat za pripremu DJ setova: analiza → auto cue → set iz Spotify liste → prelazi → rekordbox / MP3 / FL i Cubase.

## Instalacija i update (Windows)
1. Skini najnoviji **SubSet-Setup-x.y.z.exe** sa stranice **Releases** ovog repoa.
2. Pokreni ga. Windows prikazuje „protected your PC" jer instaler nije potpisan: klikni **More info → Run anyway**.
3. Prva instalacija skida Python runtime, PyTorch za NVIDIA kartice, biblioteke i Beat This! model, ukupno oko 3 GB.
4. Za update pokreneš noviji instaler preko starog. Skida se samo ono što je novo, a biblioteka i setovi ostaju.

Logovi: `%LOCALAPPDATA%\SubSet\install.log` (instalacija) i `%LOCALAPPDATA%\SubSet\subset.log` (program).

## Razvoj
- `python -m subset --browser`: pokreće program iz koda
- `python tests/smoke.py --repo`: test od početka do kraja
- `installer/build.sh`: pravi instaler na Linuxu (potreban makensis)
- Push taga `vX.Y.Z` pokreće GitHub Actions: build na Windowsu, prava silent instalacija, smoke test, test update-a preko postojeće instalacije i objavljivanje u Releases.

## Tok rada za artist set
1. **Biblioteka → + Dodaj folder**: izaberi folder sa masterima. Analiza ide u pozadini, a svaka pesma se analizira samo jednom.
2. **+ Novi set**: nalepi Spotify link plejliste (mora biti javna) ili tracklistu `Izvođač - Naziv | napomena`.
   - Pesme iz biblioteke se same povežu. Za one koje fale klikni **Izaberi folder sa pesmama koje fale**.
   - Pesma koja se ponavlja dobija napomenu „remix" i povezuje se sa fajlom koji u imenu ima „remix". Fajl uvek možeš ručno da promeniš.
3. **Napravi set**: na timeline-u su prelazi. Za svaki prelaz biraš tip (Bass swap, Blend, Cut, Echo out), dužinu u taktovima i SFX, i možeš da ga preslušaš (▶).
   - Intro i outro mogu biti „ceo", „kratak" (8 taktova) ili „preskoči". Za artist setove važi: kratak intro.
   - Kad je razlika u tempu veća od 8%, prelaz se automatski prebacuje na Echo out.
4. **Export u rekordbox**: pravi `Documents\SubSet\SubSet_rekordbox.xml` (playlista + grid + cue A zeleno / B žuto / C crveno + memory cue po frazama).
   - Jednom podesi: rekordbox → Preferences → Advanced → Database → rekordbox xml → izaberi taj fajl.
   - Zatim: levi meni **rekordbox xml** → osveži → desni klik na set → **Import Playlist**.
   - Napomena: rekordbox ne prepisuje cue-ove pesmama koje su već u kolekciji sa svojim cue-ovima. Za takve pesme prvo obriši stare cue-ove ili ih ukloni iz kolekcije, pa importuj.
5. **Render MP3/WAV**: ceo miks. **Export za FL / Cubase**: jedan FLAC po pesmi, svi počinju od 0:00 i prelazi su već ugrađeni, plus MIDI fajl sa markerima. Sve prevučeš na takt 1.

SFX: u Podešavanjima izaberi folder sa sirenama i efektima. Pojaviće se u koloni SFX kod prelaza.

## Šta radi „ispod haube"
- Beatgrid: Beat This! (CPJKU, 2024) na GPU, sa konstantnim gridom kad je pesma stabilna i dinamičkim kad tempo pliva
- Key: chroma profil u KeyFinder stilu → Camelot
- Fraze: segmentacija po taktovima (energija, bas, svetlina, ritam, harmonija) → intro / build / drop / chorus / break / verse / outro
- Harmonize: optimalni redosled (Held-Karp do 11 pesama, preko toga greedy + 2-opt) po key-u, tempu i energiji. Režim Fuzzy je za live, Mood za studio.
- Tempo: dolazna pesma se tokom prelaza sinhronizuje sa odlaznom, pa se kroz 8 taktova vraća na svoj tempo (Rubber Band preko pedalboard-a)
- Bass swap: Linkwitz-Riley podela na 160 Hz, bas se menja na sredini prelaza

## Plan
- v0.2: stemovi (htDemucs / RoFormer) i prelazi po stemu, vokalne zone, ručno pomeranje cue-ova i in/out tačaka na waveform-u
- v0.3: AI asistent („skrati drugu pesmu za 16 taktova, prelaz neka bude echo na refrenu"), nativni C++ engine, Mac build
