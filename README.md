# Rhythm Trainer

A personal Android app for learning the vocal rhythm of a song, line by line. You compare your takes with the original singer by ear and rate them yourself: there is no automatic scoring.

## What's new in version 2

- French and English, chosen on first launch.
- Two ways to set up a song: **Simple** (original song + instrumental, with a metronome instead of drums) or **Complete** (voice, drums, bass, other). There's a beginner guide for Moises (phone) and Ultimate Vocal Remover (computer).
- Marking lines: scrub bar, −5 s / +5 s, marks while paused, tap the beat to set tempo and beat position, and mark where each line **ends** (the intro is part of line 1).
- Line editor: hold − / + to move faster, and boundaries stay joined. You can merge a line with the next one.
- 3 steps (Listen, Copy, Perform). Background, Original and My take each have their own mute button, and Play includes your take. The original voice's waveform is hidden.
- Metronome during lines, a spoken count-in (or your own recorded one), and beat-aligned count-ins.
- Recording: a live mic meter, a mic test, a choice of microphone, per-route delay (speaker / wired / Bluetooth), echo and noise cleanup, automatic levelling, a backup recorder, and a per-take sync nudge.
- A landscape layout, with a suggestion to rotate at start-up.

## What it does

- **Songs as chapters, lines as lessons.** Each song is a path of round lesson buttons: line 1, line 2, lines 1–2, line 3, line 4, lines 3–4, all lines, and finally the whole song.
- **4 steps per lesson:**
    1. Listen: vocal + drums.
    2. Copy: sing over the drums only.
    3. Listen full: the whole mix.
    4. Perform: sing over the whole mix without the vocal.
- **Mixer:** mute buttons for vocal, drums and music, a 1-bar count-in, loop, and speed (75 / 90 / 100 %, same pitch).
- **Record and compare.** The original vocal and your take are shown as two stacked waveforms. Compare modes:
    - A/B: the original, then your take.
    - Overlay: both at once.
    - Your take over the instrumental.
- **Self-rating.** Rate each take with 1–5 stars, add a note, and mark one as your best. A lesson counts as done when you rate a Perform take at 100 % speed with 4★ or more (changeable in Settings).
- **Best takes:** your best take of every line, stitched over the instrumental into a full run-through. You can export it as a WAV file.
- **Motivation:** a daily streak, minutes practised per day and per week, and an optional daily reminder.
- **Storage:** everything stays on the phone. Backup and restore go through a zip file you can save to Drive.

## Adding a song (about 5–15 minutes)

1. Split the song into stems on your laptop with **Ultimate Vocal Remover** (Demucs, 4 stems) or Moises: vocals, drums, bass, other.
2. Copy the files to your phone (Drive, USB).
3. In the app, tap **Add a song**, choose the files, and set the tempo (Tap tempo helps).
4. **Tap along once:** press LINE at the start of each sung line and NEW SECTION before each verse or chorus.
5. Fix boundaries with the ±50 ms buttons if needed.

Use **wired headphones**, and run **Settings → Headphone latency** once. Hold an earbud against the phone's mic and tap *Measure automatically*.

## Getting the APK (GitHub builds it)

Every push to `main` runs `.github/workflows/android.yml`. It builds the APK and publishes it under **Releases** (also under **Actions → the run → Artifacts**). Open the latest release on your phone, download the `.apk`, and tap it. Allow "install unknown apps" for your browser or file manager the first time.

### One-time: create your signing key and add 4 secrets

Without these, the workflow builds a *debug* APK. Debug builds can't be installed as updates over each other, so you'd have to uninstall, which **deletes your takes**. Set this up before you start recording for real.

1. Create the key on your laptop. `keytool` comes with Java or Android Studio:
   ```
   keytool -genkey -v -keystore rhythm-release.jks -alias rhythm -keyalg RSA -keysize 2048 -validity 10000
   ```
   Keep `rhythm-release.jks` and its password safe, for example in a password manager. If you lose them, you can't update the app without reinstalling it.
2. Turn the key into text:
    - macOS / Linux: `base64 -i rhythm-release.jks | tr -d '\n' > key.txt` (on Linux: `base64 -w0 rhythm-release.jks > key.txt`)
    - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("rhythm-release.jks")) > key.txt`
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

   | Name | Value |
   | --- | --- |
   | `KEYSTORE_BASE64` | the content of `key.txt` |
   | `KEYSTORE_PASSWORD` | the keystore password |
   | `KEY_ALIAS` | `rhythm` |
   | `KEY_PASSWORD` | the key password (same as the keystore password if you pressed Enter) |

4. Re-run the workflow (**Actions → Build Android APK → Run workflow**). Then delete `key.txt`.

## Building it yourself instead

You need Node.js 22+ and Android Studio (it includes the SDK and Java 21):

```
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleDebug      # or assembleRelease with KEYSTORE_PATH, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD set
```

To try the web version in a desktop browser: `npm run dev`.

## Code map

| Path | What it is |
| --- | --- |
| `src/audio.ts` | Playback, time-stretching, mic capture (AudioWorklet), latency calibration, waveforms |
| `src/lessons.ts` | Builds the lesson path (drill order) from a song's sections and lines |
| `src/db.ts` | IndexedDB storage: songs, takes, audio, settings, stats |
| `src/views/*` | Screens: home, song path, lesson, tap-to-mark, line editor, best takes, settings |
| `src/backup.ts` | Zip backup and restore |
| `src/native.ts` | Android reminders and the share sheet |
| `android/` | Capacitor Android project (permissions, signing, icon) |
