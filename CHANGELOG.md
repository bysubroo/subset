# Changelog

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
