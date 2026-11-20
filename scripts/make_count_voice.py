"""Generate natural-sounding count-in words (1-8, English and French) with Piper,
an open-source neural text-to-speech engine that runs offline on your computer.

Usage (from the project folder):
    pip install piper-tts
    python3 scripts/make_count_voice.py
    # or choose other voices:
    python3 scripts/make_count_voice.py --en en_US-lessac-medium --fr fr_FR-upmc-medium

It downloads the two voices into scripts/voices/ (once) and writes
public/count/en1.wav ... en8.wav and fr1.wav ... fr8.wav, each trimmed so the word
starts right at the beginning of the file (that keeps the count-in on the beat).
"""
import argparse, os, subprocess, sys, wave, array, io

WORDS = {
    'en': ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'],
    'fr': ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit'],
}
HERE = os.path.dirname(os.path.abspath(__file__))
VOICES = os.path.join(HERE, 'voices')
OUT = os.path.join(HERE, '..', 'public', 'count')


def trim(samples, rate):
    peak = max(1, max(abs(s) for s in samples))
    thr = peak * 0.06
    start = next(i for i, s in enumerate(samples) if abs(s) > thr)
    end = len(samples) - next(i for i, s in enumerate(reversed(samples)) if abs(s) > thr)
    start = max(0, start - int(rate * 0.004))
    end = min(len(samples), end + int(rate * 0.06))
    gain = 29000 / peak
    out = array.array('h', (max(-32767, min(32767, int(s * gain))) for s in samples[start:end]))
    # 8 ms fade-out so the cut is silent
    fade = min(len(out), int(rate * 0.008))
    for k in range(fade):
        out[len(out) - fade + k] = int(out[len(out) - fade + k] * (1 - (k + 1) / fade))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--en', default='en_GB-alba-medium', help='Piper voice for English')
    ap.add_argument('--fr', default='fr_FR-siwis-medium', help='Piper voice for French')
    ap.add_argument('--speed', type=float, default=0.9, help='< 1 speaks faster (shorter words)')
    a = ap.parse_args()
    from piper import PiperVoice, SynthesisConfig
    os.makedirs(VOICES, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    for lang, name in (('en', a.en), ('fr', a.fr)):
        model = os.path.join(VOICES, name + '.onnx')
        if not os.path.exists(model):
            print('Downloading voice', name)
            subprocess.run([sys.executable, '-m', 'piper.download_voices', name, '--download-dir', VOICES], check=True)
        voice = PiperVoice.load(model)
        cfg = SynthesisConfig(length_scale=a.speed)
        for i, word in enumerate(WORDS[lang], start=1):
            buf = io.BytesIO()
            with wave.open(buf, 'wb') as w:
                voice.synthesize_wav(word, w, syn_config=cfg)
            buf.seek(0)
            with wave.open(buf, 'rb') as r:
                rate = r.getframerate()
                samples = array.array('h', r.readframes(r.getnframes()))
            out = trim(samples, rate)
            path = os.path.join(OUT, f'{lang}{i}.wav')
            with wave.open(path, 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
                w.writeframes(out.tobytes())
            print(f'{path}  {len(out) / rate:.2f} s')
    print('Done. Now rebuild: npm run build && npx cap sync android && cd android && ./gradlew assembleDebug')


if __name__ == '__main__':
    main()
