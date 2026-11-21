# Changelog

## 0.2.0
- Potpuno nov interfejs: grafit + SubRoo pink, Satoshi / IBM Plex Mono, gusta tabela (virtualizovana), Camelot točak za filtriranje, filteri BPM/energija/kompatibilnost
- Deck sa zumiranim i pregled waveform-om (Rekordbox 3-band), fraze, grid, hot cue dugmad; omoti iz tagova
- Set: timeline sa dve trake i krivama prelaza, minimapa, BPM kriva, playlist tabela sa key odnosom, Δ tempa, drag & drop
- Plejer svira ceo set uživo (Web Audio): sinhronizacija tempa, bass swap, filter sweep, echo out, SFX — bez renderovanja
- Editor prelaza: Bass swap, Crossfade, High to low, Low to high, Echo out, Cut; dužina 1–32 takta; SFX; primeni na sve
- Export dijalog: MP3/WAV/FLAC (16/24/32 bit) + tracklista, Rekordbox (M3U8 + XML), M3U8/M3U/TXT/CSV, FL/Cubase

## 0.1.3
- Export u rekordbox pravi i .m3u8 plejlistu (rekordbox: File > Import > Import Playlist); XML ostaje za cue-ove i grid
- Posle exporta se otvara folder sa fajlovima

## 0.1.2
- Beatgrid: Beat This! + precizno doterivanje tempa (autokorelacija) - tacan BPM i bez kvantizacije modela od 20 ms
- Stabilnost tempa se meri lokalnim tempom, faza grida po kicku (+ korekcija 14 ms)
- Windows: UTF-8 izlaz (pad zbog cp1252 konzole), install.log sa celim tokom instalacije
- CI: svaki push na main pravi instaler, instalira ga na Windowsu, testira i objavljuje Release

## 0.1.1
- Windows installer (`SubSet-Setup-x.y.z.exe`): bundled Python 3.11, downloads PyTorch (CUDA) + libraries + Beat This! model, updates in place
- SubSet.exe launcher, Start menu / Desktop shortcuts, uninstaller
- Single-instance guard, version shown in the app

## 0.1.0
- Library scan + analysis (beatgrid, key/Camelot, energy, phrases), auto cues (A green / B yellow / C red + memory cues)
- Sets from Spotify link or tracklist, matching with duplicate → remix
- Harmonize (Fuzzy/Mood, tempo direction), transitions (Bass swap, Blend, Cut, Echo out), previews
- Exports: rekordbox XML, MP3/WAV mix, FL/Cubase stems + MIDI markers
