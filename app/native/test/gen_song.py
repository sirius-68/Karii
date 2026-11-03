#!/usr/bin/env python3
"""Builds a test "song" with known word timing: a band (wide stereo chords, centred kick and
bass, and a centred lead synth in the instrumental break) with words spoken by espeak-ng placed
at exact times, a 14 s instrumental intro and a 12 s instrumental break.
Writes song.wav (44.1 kHz stereo 16-bit), truth.txt (word<TAB>start), lyrics.txt and regions.txt."""
import math, os, subprocess, sys, tempfile, wave
import numpy as np

out = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(out, exist_ok=True)
SR = 44100
DUR = 54.0
n = int(SR * DUR)
t = np.arange(n) / SR
rng = np.random.default_rng(4)

# --- band
L = np.zeros(n); R = np.zeros(n)
chords = [(261.6, 329.6, 392.0), (220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (196.0, 246.9, 293.7)]
for i in range(int(DUR / 2) + 1):
    a, b = int(i * 2 * SR), min(n, int((i + 1) * 2 * SR))
    if a >= n: break
    c = chords[i % 4]
    seg = t[a:b] - t[a]
    env = np.minimum(1, seg * 8) * np.exp(-seg * 0.4)
    L[a:b] += 0.05 * env * (np.sin(2 * np.pi * c[0] * seg) + 0.6 * np.sin(2 * np.pi * c[2] * seg))
    R[a:b] += 0.05 * env * (np.sin(2 * np.pi * c[1] * seg) + 0.6 * np.sin(2 * np.pi * c[0] * 2 * seg))
    bass = 0.12 * env * np.sin(2 * np.pi * c[0] / 4 * seg)
    L[a:b] += bass; R[a:b] += bass
kp = np.mod(t, 0.5)
kick = 0.35 * np.sin(2 * np.pi * 55 * kp) * np.exp(-kp * 20)
hp = np.mod(t + 0.25, 0.5)
hat = np.where(hp < 0.03, 0.03 * rng.standard_normal(n), 0)
L += kick + hat; R += kick - hat
# centred lead synth in the break only (an instrument where a voice would usually be)
brk = (t >= 27.5) & (t < 37.0)
lead_f = 523.3 * np.where(np.mod(t, 1.0) < 0.5, 1.0, 1.122)
lead = 0.04 * np.sign(np.sin(2 * np.pi * lead_f * t)) * brk
L += lead; R += lead

# --- words
lines = [
    (14.0, "every night I see the city lights"),
    (17.6, "shining on the river where we used to walk"),
    (21.8, "every night I hear you calling"),
    (38.0, "hold on to me and never let me go"),
    (42.2, "shining on the river every night"),
    (46.4, "every night I hear you calling me home"),
]
voice = np.zeros(n)
truth = []
tmp = tempfile.mkdtemp()
for start, text in lines:
    pos = start
    for w in text.split():
        f = os.path.join(tmp, 'w.wav')
        subprocess.run(['espeak-ng', '-s', '150', '-v', 'en-us', '-w', f, w], check=True)
        with wave.open(f) as wf:
            sr = wf.getframerate()
            x = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        idx = np.nonzero(np.abs(x) > 0.02)[0]
        x = x[idx[0]:idx[-1] + 1] if len(idx) else x
        y = np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x)
        a = int(pos * SR)
        voice[a:a + len(y)] += y[: max(0, min(len(y), n - a))]
        truth.append((w, pos))
        pos += len(y) / SR + 0.07
voice *= 0.55 / max(1e-9, np.max(np.abs(voice)))
L += voice; R += voice
peak = max(np.max(np.abs(L)), np.max(np.abs(R)))
L *= 0.9 / peak; R *= 0.9 / peak
pcm = np.empty(2 * n, dtype=np.int16)
pcm[0::2] = np.round(L * 32767); pcm[1::2] = np.round(R * 32767)
with wave.open(os.path.join(out, 'song.wav'), 'wb') as wf:
    wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(SR); wf.writeframes(pcm.tobytes())
with open(os.path.join(out, 'truth.txt'), 'w') as f:
    for w, s in truth: f.write(f"{w}\t{s:.3f}\n")
with open(os.path.join(out, 'lyrics.txt'), 'w') as f:
    f.write('\n'.join(l for _, l in lines) + '\n')
print(f"song.wav: {DUR:.0f} s, {len(truth)} words, first word at {truth[0][1]:.2f} s")
