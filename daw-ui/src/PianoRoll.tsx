import React, { useState, useRef } from 'react';

// Simple incremental ID generator
let synthIdCounter = 1;
function getNextSynthId() {
  return `synth-${synthIdCounter++}`;
}

type NoteEvent = [string, number, number]; // [note(s), start, duration]
type TrackType = 'Track' | 'WavTrack';

type SynthConfig = {
  id: string;
  sample_rate: number;
  bpm: number;
  volume?: number;
  waveform?: string;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
};

type Track = {
  name: string;
  cfg_id: string;
  events: NoteEvent[];
  gain: number;
  type: TrackType;
  wavFile?: string;
  wavFileObj?: File;
  fullPath?: string; // For user-entered full path
};

const pitches = [
  "C6","B5","A#5","A5","G#5","G5","F#5","F5","E5","D#5","D5","C#5","C5",
  "B4","A#4","A4","G#4","G4","F#4","F4","E4","D#4","D4","C#4","C4",
  "B3","A#3","A3","G#3","G3","F#3","F3","E3","D#3","D3","C#3","C3",
  "B2","A#2","A2","G#2","G2","F#2","F2","E2","D#2","D2","C#2","C2"
];
const beats = Array.from({ length: 32 }, (_, i) => i * 0.5); // 8 bars of 8th notes

const defaultSynthParams = {
  volume: 0.5,
  waveform: "sine",
  attack: 0.01,
  decay: 0.05,
  sustain: 0.8,
  release: 0.05,
};

function PianoRoll() {
  // State
  const [bpm, setBpm] = useState(120);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [synthConfigs, setSynthConfigs] = useState<SynthConfig[]>([]);
  const [selectedTrackIdx, setSelectedTrackIdx] = useState<number>(-1);
  const [dirty, setDirty] = useState(false);
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [samples, setSamples] = useState<Record<string, string>>({});

  // For add track
  const [newTrack, setNewTrack] = useState<{ name: string; type: TrackType; wavFile?: string; wavFileObj?: File; fullPath?: string }>({
    name: '',
    type: 'Track'
  });

  // For piano roll note editing
  const [dragStart, setDragStart] = useState<{ pitch: string, beat: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ pitch: string, beat: number } | null>(null);

  // For keeping a single wav synth config id
  const wavSynthId = useRef<string>(getNextSynthId());

  // --- Track and SynthConfig helpers ---
  const selectedTrack = tracks[selectedTrackIdx];
  const selectedSynthConfig = selectedTrack
    ? synthConfigs.find(cfg => cfg.id === selectedTrack.cfg_id)
    : undefined;

  // --- Piano roll note helpers ---
  function getTrackNotes(track: Track) {
    if (!track) return [];
    return track.events.flatMap(ev => {
      const notes = ev[0].split('+');
      return notes.map(note => ({
        pitch: note,
        beat: ev[1],
        duration: ev[2]
      }));
    });
  }
  const notes = selectedTrack ? getTrackNotes(selectedTrack) : [];

  function updateTrackEvents(newEvents: NoteEvent[]) {
    setTracks(tracks =>
      tracks.map((t, idx) =>
        idx === selectedTrackIdx ? { ...t, events: newEvents } : t
      )
    );
    setDirty(true);
  }

  function handleNoteMouseDown(pitch: string, beat: number, e?: React.MouseEvent) {
    if (e && e.button !== 0) return;
    setDragStart({ pitch, beat });
    setDragCurrent({ pitch, beat });
  }
  function handleNoteMouseEnter(pitch: string, beat: number) {
    if (dragStart) setDragCurrent({ pitch, beat });
  }
  function handleNoteMouseUp(pitch: string, beat: number) {
    if (!selectedTrack) return;
    if (dragStart && dragCurrent) {
      const start = Math.min(dragStart.beat, dragCurrent.beat);
      const end = Math.max(dragStart.beat, dragCurrent.beat);
      const duration = end - start + 0.5;
      let events = [...selectedTrack.events];
      events = events.filter(ev => {
        const evNotes = ev[0].split('+');
        return !(evNotes.includes(dragStart.pitch) && ev[1] >= start && ev[1] <= end);
      });
      events.push([dragStart.pitch, start, duration]);
      updateTrackEvents(events);
    }
    setDragStart(null);
    setDragCurrent(null);
  }
  function handleNoteContextMenu(e: React.MouseEvent, pitch: string, beat: number) {
    e.preventDefault();
    if (!selectedTrack) return;
    let events = [...selectedTrack.events];
    events = events.filter(ev => {
      const evNotes = ev[0].split('+');
      return !(evNotes.includes(pitch) && beat >= ev[1] && beat < ev[1] + ev[2]);
    });
    updateTrackEvents(events);
  }
  function isNoteStart(pitch: string, beat: number) {
    return notes.some(n => n.pitch === pitch && n.beat === beat);
  }
  function isNoteBody(pitch: string, beat: number) {
    return notes.some(n => n.pitch === pitch && beat > n.beat && beat < n.beat + n.duration);
  }
  function isPreview(pitch: string, beat: number) {
    if (!dragStart || !dragCurrent) return false;
    if (pitch !== dragStart.pitch) return false;
    const start = Math.min(dragStart.beat, dragCurrent.beat);
    const end = Math.max(dragStart.beat, dragCurrent.beat);
    return beat >= start && beat <= end;
  }

  // --- Track List ---
  function handleSelectTrack(idx: number) {
    setSelectedTrackIdx(idx);
  }
  function handleRemoveTrack(idx: number) {
    setTracks(tracks => tracks.filter((_, i) => i !== idx));
    setDirty(true);
    if (selectedTrackIdx === idx) setSelectedTrackIdx(-1);
    else if (selectedTrackIdx > idx) setSelectedTrackIdx(selectedTrackIdx - 1);
  }

  // --- Add Track ---
  function handleAddTrack() {
    if (!newTrack.name) return;
    if (newTrack.type === 'Track') {
      const synthId = getNextSynthId();
      setSynthConfigs(cfgs => [
        ...cfgs,
        {
          id: synthId,
          sample_rate: 44100,
          bpm,
          ...defaultSynthParams
        }
      ]);
      setTracks(tracks => {
        const newTracks = [
          ...tracks,
          {
            name: newTrack.name,
            cfg_id: synthId,
            events: [],
            gain: 1,
            type: 'Track' as TrackType
          }
        ];
        setSelectedTrackIdx(newTracks.length - 1); // Auto-select new track
        return newTracks;
      });
    } else {
      setTracks(tracks => {
        const newTracks = [
          ...tracks,
          {
            name: newTrack.name,
            cfg_id: wavSynthId.current,
            events: [],
            gain: 1,
            type: 'WavTrack' as TrackType,
            wavFile: newTrack.wavFile,
            wavFileObj: newTrack.wavFileObj,
            fullPath: newTrack.fullPath
          }
        ];
        setSelectedTrackIdx(newTracks.length - 1); // Auto-select new track
        return newTracks;
      });
      if (!synthConfigs.find(cfg => cfg.id === wavSynthId.current)) {
        setSynthConfigs(cfgs => [
          ...cfgs,
          {
            id: wavSynthId.current,
            sample_rate: 44100,
            bpm
          }
        ]);
      }
    }
    setNewTrack({ name: '', type: 'Track' });
    setDirty(true);
  }

  // --- Parameter Box ---
  function handleSynthParamChange(param: keyof SynthConfig, value: any) {
    if (!selectedSynthConfig) return;
    setSynthConfigs(cfgs =>
      cfgs.map(cfg =>
        cfg.id === selectedSynthConfig.id ? { ...cfg, [param]: value } : cfg
      )
    );
    setDirty(true);
  }
  function handleTrackGainChange(value: number) {
    setTracks(tracks =>
      tracks.map((t, idx) =>
        idx === selectedTrackIdx ? { ...t, gain: value } : t
      )
    );
    setDirty(true);
  }

  // --- Backend helpers ---
  function buildSamplesObj() {
    if (Object.keys(samples).length > 0) return samples;
    const samplesObj: Record<string, string> = {};
    tracks.forEach(t => {
      if (t.type === 'WavTrack' && (t.fullPath || t.wavFile)) {
        samplesObj[t.name] = t.fullPath || t.wavFile || '';
      }
    });
    return samplesObj;
  }
  function buildSynthConfigsObj() {
    return synthConfigs.map(cfg => {
      if (tracks.some(t => t.cfg_id === cfg.id && t.type === 'Track')) {
        return {
          id: cfg.id,
          sample_rate: 44100,
          bpm,
          volume: cfg.volume,
          waveform: cfg.waveform,
          attack: cfg.attack,
          decay: cfg.decay,
          sustain: cfg.sustain,
          release: cfg.release
        };
      } else {
        return {
          id: cfg.id,
          sample_rate: 44100,
          bpm
        };
      }
    });
  }
  function buildTracksObj() {
    return tracks.map(t => ({
      name: t.name,
      cfg_id: t.cfg_id,
      events: t.events,
      gain: t.gain,
      type: t.type
    }));
  }

  // --- Song sync ---
  const lastSongData = useRef<string>('');
  async function ensureSongIsCurrent() {
    const songData = JSON.stringify({
      samples: buildSamplesObj(),
      SynthConfigs: buildSynthConfigsObj(),
      Tracks: buildTracksObj()
    });
    if (!dirty && songData === lastSongData.current) return;
    await fetch('http://127.0.0.1:5050/create_song', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: songData
    });
    lastSongData.current = songData;
    setDirty(false);
  }

  // --- Play ---
  async function handlePlay() {
    await ensureSongIsCurrent();
    const res = await fetch('http://127.0.0.1:5050/play_song', { method: 'POST' });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  }

  // --- Chat ---
  async function handleChat() {
    setChatLoading(true);
    await ensureSongIsCurrent();
    const res = await fetch('http://127.0.0.1:5050/llm_edit_song', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: chatPrompt }),
    });
    const data = await res.json();
    setTracks(data.Tracks);
    setSynthConfigs(data.SynthConfigs);
    setDirty(false);
    lastSongData.current = JSON.stringify({
      samples: buildSamplesObj(),
      SynthConfigs: buildSynthConfigsObj(),
      Tracks: buildTracksObj()
    });
    setSelectedTrackIdx(0);
    setChatPrompt("");
    setChatLoading(false);

    // Play the new song
    const playRes = await fetch('http://127.0.0.1:5050/play_song', { method: 'POST' });
    const playBlob = await playRes.blob();
    const playUrl = URL.createObjectURL(playBlob);
    const audio = new Audio(playUrl);
    audio.play();
  }

  // --- Revert ---
  async function handleRevert() {
    const res = await fetch('http://127.0.0.1:5050/revert_song', { method: 'GET' });
    const data = await res.json();
    setTracks(data.Tracks);
    setSynthConfigs(data.SynthConfigs);
    setSamples(data.samples || {});
    setSelectedTrackIdx(0);
    setDirty(false);
  }

  // --- Save ---
  async function handleSave() {
    await ensureSongIsCurrent();
    await fetch('http://127.0.0.1:5050/save_song', { method: 'POST' });
  }

  // --- UI ---
  return (
    <div>
      {/* Global BPM */}
      <div style={{ marginBottom: 16 }}>
        <label>
          <b>BPM:</b>
          <input
            type="number"
            min={30}
            max={300}
            value={bpm}
            onChange={e => { setBpm(parseInt(e.target.value)); setDirty(true); }}
            style={{ width: 60, marginLeft: 8 }}
          />
        </label>
      </div>

      {/* Play, Save, Revert, Chat */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={handlePlay} title="Play" style={{ fontSize: 20, padding: "4px 12px" }}>
          ▶
        </button>
        <button onClick={handleSave} style={{ marginLeft: 8 }}>Save</button>
        <button onClick={handleRevert} style={{ marginLeft: 8 }}>Revert</button>
      </div>

      {/* Add Track */}
      <div style={{ border: '1px solid #ccc', padding: 10, marginBottom: 16, display: 'inline-block' }}>
        <div>
          <label>
            Name:
            <input
              value={newTrack.name}
              onChange={e => setNewTrack(nt => ({ ...nt, name: e.target.value }))}
              style={{ marginLeft: 8, width: 100 }}
            />
          </label>
          <label style={{ marginLeft: 16 }}>
            Type:
            <select
              value={newTrack.type}
              onChange={e => setNewTrack(nt => ({ ...nt, type: e.target.value as TrackType }))}
              style={{ marginLeft: 8 }}
            >
              <option value="Track">Synth</option>
              <option value="WavTrack">WavTrack</option>
            </select>
          </label>
        </div>
        {newTrack.type === 'WavTrack' && (
          <div style={{ marginTop: 8 }}>
            <label>
              WAV File:
              <input
                type="file"
                accept=".wav"
                onChange={e => {
                  const file = e.target.files?.[0];
                  setNewTrack(nt => ({
                    ...nt,
                    wavFile: file ? file.name : undefined,
                    wavFileObj: file,
                  }));
                }}
                style={{ marginLeft: 8 }}
              />
              {newTrack.wavFile && (
                <span style={{ marginLeft: 8 }}>{newTrack.wavFile}</span>
              )}
            </label>
            <div style={{ marginTop: 8 }}>
              <label>
                Full Path:
                <input
                  type="text"
                  value={newTrack.fullPath || ''}
                  onChange={e => setNewTrack(nt => ({ ...nt, fullPath: e.target.value }))}
                  style={{ marginLeft: 8, width: 300 }}
                  placeholder="Paste the full path to your .wav file"
                />
              </label>
            </div>
          </div>
        )}
        <button
          onClick={handleAddTrack}
          style={{ marginLeft: 16, marginTop: 8 }}
          disabled={newTrack.type === 'WavTrack' && !(newTrack.wavFile && newTrack.fullPath)}
        >
          + Add Track
        </button>
      </div>

      {/* Track List (now below Add Track) */}
      <div style={{ marginBottom: 16 }}>
        {tracks.map((track, idx) => (
          <span key={track.name} style={{ marginRight: 8 }}>
            <button
              onClick={() => handleSelectTrack(idx)}
              style={{
                fontWeight: idx === selectedTrackIdx ? 'bold' : 'normal',
                background: idx === selectedTrackIdx ? '#e0e0e0' : '#fff'
              }}
            >
              {track.name} <span style={{fontSize: 10}}>({track.type})</span>
            </button>
            <button
              onClick={() => handleRemoveTrack(idx)}
              style={{ marginLeft: 2, color: 'red', fontWeight: 'bold' }}
              title="Remove track"
            >×</button>
          </span>
        ))}
      </div>

      {/* Parameter Box */}
      {selectedTrack && (
        <div style={{ border: '1px solid #aaa', padding: 10, marginBottom: 16 }}>
          <div><b>Parameter</b></div>
          {selectedTrack.type === 'Track' && selectedSynthConfig && (
            <>
              <label>
                Waveform:
                <select
                  value={selectedSynthConfig.waveform}
                  onChange={e => handleSynthParamChange('waveform', e.target.value)}
                  style={{ marginLeft: 8 }}
                >
                  <option value="sine">Sine</option>
                  <option value="square">Square</option>
                  <option value="saw">Saw</option>
                  <option value="triangle">Triangle</option>
                </select>
              </label>
              <label style={{ marginLeft: 16 }}>
                Gain:
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.01}
                  value={selectedTrack.gain}
                  onChange={e => handleTrackGainChange(parseFloat(e.target.value))}
                  style={{ width: 60, marginLeft: 8 }}
                />
              </label>
              <label style={{ marginLeft: 16 }}>
                Attack:
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedSynthConfig.attack}
                  onChange={e => handleSynthParamChange('attack', parseFloat(e.target.value))}
                  style={{ width: 60, marginLeft: 8 }}
                />
              </label>
              <label style={{ marginLeft: 16 }}>
                Decay:
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedSynthConfig.decay}
                  onChange={e => handleSynthParamChange('decay', parseFloat(e.target.value))}
                  style={{ width: 60, marginLeft: 8 }}
                />
              </label>
              <label style={{ marginLeft: 16 }}>
                Sustain:
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedSynthConfig.sustain}
                  onChange={e => handleSynthParamChange('sustain', parseFloat(e.target.value))}
                  style={{ width: 60, marginLeft: 8 }}
                />
              </label>
              <label style={{ marginLeft: 16 }}>
                Release:
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedSynthConfig.release}
                  onChange={e => handleSynthParamChange('release', parseFloat(e.target.value))}
                  style={{ width: 60, marginLeft: 8 }}
                />
              </label>
            </>
          )}
          {selectedTrack.type === 'WavTrack' && (
            <label>
              Gain:
              <input
                type="number"
                min={0}
                max={2}
                step={0.01}
                value={selectedTrack.gain}
                onChange={e => handleTrackGainChange(parseFloat(e.target.value))}
                style={{ width: 60, marginLeft: 8 }}
              />
            </label>
          )}
        </div>
      )}

      {/* Piano roll grid */}
      {selectedTrack && (
        <div style={{ maxHeight: 400, overflowY: 'auto', maxWidth: 900, overflowX: 'auto', border: '1px solid #ddd', marginBottom: 16 }}>
          <table style={{ borderCollapse: 'collapse', userSelect: 'none', minWidth: 600 }}>
            <tbody>
              {pitches.map(pitch => (
                <tr key={pitch}>
                  <td style={{ width: 40, textAlign: 'right', fontWeight: 'bold', background: '#f8f8f8', position: 'sticky', left: 0 }}>{pitch}</td>
                  {beats.map((beat, beatIdx) => {
                    // Highlight every 4 bars (8 beats = 4 bars if 2 beats per bar)
                    const isBarStart = (beatIdx % 8 === 0);
                    return (
                      <td
                        key={beat}
                        style={{
                          width: 24,
                          height: 24,
                          border: '1px solid #ccc',
                          background: isNoteStart(pitch, beat)
                            ? '#388e3c'
                            : isNoteBody(pitch, beat)
                            ? '#81c784'
                            : isPreview(pitch, beat)
                            ? '#a5d6a7'
                            : isBarStart
                            ? '#f0f0f0' // light gray for bar start
                            : '#fff',
                          cursor: 'pointer',
                        }}
                        onMouseDown={e => handleNoteMouseDown(pitch, beat, e)}
                        onMouseEnter={() => handleNoteMouseEnter(pitch, beat)}
                        onMouseUp={() => handleNoteMouseUp(pitch, beat)}
                        onContextMenu={e => handleNoteContextMenu(e, pitch, beat)}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Chat box below the piano roll */}
      <div style={{ marginTop: 24 }}>
        <input
          type="text"
          placeholder="Chat with GPT about your song..."
          value={chatPrompt}
          onChange={e => setChatPrompt(e.target.value)}
          style={{ width: 300 }}
        />
        <button onClick={handleChat} style={{ marginLeft: 8 }} disabled={chatLoading}>
          {chatLoading ? "Chatting..." : "Chat"}
        </button>
      </div>
    </div>
  );
}

export default PianoRoll;