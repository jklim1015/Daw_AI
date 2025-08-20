import math
import wave
from dataclasses import dataclass, field
import re
from typing import List
import numpy as np
import uuid
import sounddevice as sd
from scipy.io import wavfile
import json
import io
import soundfile as sf

Note = str | float
Event = tuple[Note, float]

A4 = 440.0
NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
FLAT_TO_SHARP = {'DB':'C#','EB':'D#','GB':'F#','AB':'G#','BB':'A#'}
SAMPLE_RATE = 44100

note_re = re.compile(r'^([A-Ga-g])([#B]?)(-?\d+)$')


def load_wav(filename):
    sr, audio = wavfile.read(filename)
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32767
    elif audio.dtype == np.int32:
        audio = audio.astype(np.float32) / (2 ** 23)
    elif audio.dtype == np.uint8:
        audio = (audio.astype(np.float32) - 128) / 128
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    return audio, sr

def note_to_freq(note: str) -> float:
    n = note.strip().upper()
    m = note_re.match(n)
    if not m:
        raise ValueError(f"Bad note format: {note}")
    base, accidental, octave_str = m.groups()
    name = base + accidental
    if 'B' in name and len(name) == 2 and name[1] == 'B':
        name = FLAT_TO_SHARP.get(name, name)
    octave = int(octave_str)
    semi = NOTE_NAMES.index(name) - NOTE_NAMES.index('A') + (octave - 4) * 12
    return A4 * (2 ** (semi/12))

def parse_note(n: Note) -> float:
    return float(n) if isinstance(n, (int, float)) else note_to_freq(n)

class SynthConfig:
    def __init__(self, sample_rate=SAMPLE_RATE, bpm=120, volume=0.5, waveform="sine", attack=0.01, decay=0.05, sustain=0.8, release=0.05):
        self.id = str(uuid.uuid4())
        self.sample_rate = sample_rate
        self.bpm = bpm
        self.volume = volume
        self.waveform = waveform
        self.attack = attack
        self.decay = decay
        self.sustain = sustain
        self.release = release
    
    def _get_id(self):
        return self.id
    

def _envelope(n, sr, a, d, s, r):
    env = np.ones(n, dtype=np.float32)
    A, D, R = int(a*sr), int(d*sr), int(r*sr)
    S = max(0, n-(A+D+R))
    if A: env[:A] = np.linspace(0, 1, A, endpoint=False)
    if D: env[A:A+D] = np.linspace(1, s, D, endpoint=False)
    if S: env[A+D:A+D+S] = s 
    if R: env[A+D+S:A+D+S+R] = np.linspace(s, 0, R, endpoint=True)
    return env

def _osc(waveform, freq, t):
    if freq <= 0: return np.zeros_like(t, dtype=np.float32)
    w = 2*np.pi*freq*t
    if waveform == "sine": return np.sin(w)
    if waveform == "square": return np.sign(np.sin(w))
    if waveform == "triangle": return 2/np.pi*np.arcsin(np.sin(w))
    if waveform == "saw":
        y = np.zeros_like(t)
        for k in range(1, 15): y += (1.0/k)*np.sin(2*np.pi*k*freq*t)
        return (2/np.pi)*y
    return np.sin(w)

class Track:
    def __init__(self, name: str, cfg: SynthConfig, events=None, gain=1.0):
        self.name = name
        self.events = [] if events is None else list(events)
        self.cfg = cfg
        self.gain = gain
    
    def add(self, note, start, duration):
        self.events.append((note, start, duration))
        return self
    
    def _get_events(self):
        if self.events ==[]:
            print(f"No events for {self.name}")
        return self.events
    
    def _get_cfg(self):
        return self.cfg
    
    def _get_track(self):
        return {
            "name": self.name,
            "cfg_id": self.cfg._get_id(),
            "events": self.events,
            "gain": self.gain
        }
    
    def render(self):
        sr, spb = self.cfg.sample_rate, 60/self.cfg.bpm
        # Find the end of the last note
        total_beats = max((start + dur) for _, start, dur in self.events) if self.events else 0
        total_sec = total_beats * spb
        buf = np.zeros(int(total_sec * sr), dtype=np.float32)
        for note, start, dur in self.events:
            n = int(dur * spb * sr)
            t = np.arange(n) / sr
            if isinstance(note, str) and "+" in note:
                y = np.mean([_osc(self.cfg.waveform, parse_note(x), t) for x in note.split('+')], axis=0)
            else:
                y = _osc(self.cfg.waveform, parse_note(note), t)
            y *= _envelope(n, sr, self.cfg.attack, self.cfg.decay, self.cfg.sustain, self.cfg.release)
            start_idx = int(start * spb * sr)
            end_idx = start_idx + n
            buf[start_idx:end_idx] += y * self.gain
        mx = float(np.max(np.abs(buf)))
        if mx > 0:
            buf /= mx
        return buf * self.cfg.volume

class WavTrack(Track):
    def __init__(self, name, cfg, sample_path, events=None, gain=1.0):
        super().__init__(name, cfg, events, gain)
        self.sample, _ = load_wav(sample_path)

    def render(self):
        sr, spb = self.cfg.sample_rate, 60/self.cfg.bpm
        total_beats = max((start + dur) for _, start, dur in self.events) if self.events else 0
        total_sec = total_beats * spb
        buf = np.zeros(int(total_sec * sr), dtype=np.float32)
        for note, start, duration in self.events:
            #if note != self.name:
                #continue  # Only play this track's sample
            start_idx = int(start * spb * sr)
            end_idx = start_idx + len(self.sample)
            if end_idx > len(buf):
                end_idx = len(buf)
            buf[start_idx:end_idx] += self.sample[:end_idx - start_idx] * self.gain
        mx = float(np.max(np.abs(buf)))
        if mx > 0:
            buf /= mx
        return buf * self.cfg.volume      
    
class Song:
    def __init__(self, cfg: SynthConfig, tracks=None, samples={}):
        self.tracks = [] if tracks is None else list(tracks)
        self.cfg = cfg
        self.samples = samples
    
    def add_track(self, t: Track): 
        self.tracks.append(t)
        return self
    
    def add_multipe_tracks(self, t: List[Track]):
        self.tracks.extend(t)
        return self

    def mixdown(self):
        if not self.tracks:
            return np.zeros(1, dtype=np.float32)
        bufs = [t.render() for t in self.tracks]
        n = max(len(b) for b in bufs)
        mix = np.zeros(n, dtype=np.float32)
        for b in bufs: 
            mix[:len(b)] += b
        mx = float(np.max(np.abs(mix)))
        if mx > 1.0:
            mix /= mx
        return mix
    
    def play(self):
        audio = self.mixdown()
        sd.play(audio, self.cfg.sample_rate)
        sd.wait()
    
    def render_wav(self):
        audio = self.mixdown()
        buf = io.BytesIO()
        sf.write(buf, audio, self.cfg.sample_rate, format='WAV')
        buf.seek(0)
        return buf.read()

    def write_wav(self, path):
        audio = self.mixdown()
        with wave.open(path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.cfg.sample_rate)
            wf.writeframes((audio*32767).astype(np.int16).tobytes())

    def save_song(self):
        song_info = {"samples": self.samples}
        tracks_info = []
        cfg_set = set()
        for t in self.tracks:
            cfg_set.add(t._get_cfg())
            t_info = t._get_track()
            t_info["type"] = type(t).__name__
            tracks_info.append(t_info)
        cfg_info = [vars(cfg) for cfg in cfg_set]
        song_info["SynthConfigs"] = cfg_info
        song_info["Tracks"] = tracks_info
        return song_info
    
def save_song(song, samples, json_path="recent_song_info.json"):
    song_info = song.save_song()
    with open(json_path, "w") as f:
        json.dump(song_info, f, indent=2, default=str)


if __name__ == "__main__":
    #load samples
    samples = {"kick": "/Users/joshlim/Desktop/kick_test.wav"}
    cfg = SynthConfig(bpm=96, waveform="saw")
    drums = WavTrack("kick", cfg, "/Users/joshlim/Desktop/kick_test.wav", gain=1).add("kick",0,2).add("kick",2,2)
    mel = Track("melody", cfg, gain=1).add("C4",0,1).add("C4",0.5,1).add("D4",1,1).add("Eb4",2,1).add("G4",3,1)
    chd = Track("chords", cfg, gain=1).add("C3+E3+G3",0,2).add("F3+A3+C4",2,2)
    song = Song(cfg, samples=samples).add_track(chd).add_track(mel).add_track(drums)
    song.write_wav("test.wav")
    save_song(song, samples)
    

