import json
import re
import openai 
from seq import Song, Track, WavTrack, SynthConfig

OPENAI_API_KEY = "PUT_API_KEY_HERE"
def load_song(path=None, data=None):
    if data is None and path is None:
        raise ValueError("You must provide either a file path or a data dictionary to load_song.")
    if data is None:
        with open(path) as f: # type: ignore
            data = json.load(f)
    samples = data["samples"]
    cfgs = {}
    for cfg_info in data["SynthConfigs"]:
        cfg_args = {k: v for k, v in cfg_info.items() if k != "id"}
        cfg = SynthConfig(**cfg_args)
        cfgs[str(cfg_info.get("id"))] = cfg
    tracks = []
    for t in data["Tracks"]:
        cfg = cfgs[str(t["cfg_id"])]
        if t["type"] == "Track":
            track = Track(t["name"], cfg, t["events"], gain=t.get("gain"))
        elif t["type"] == "WavTrack":
            track = WavTrack(t["name"], cfg, samples[t["name"]], t["events"], gain=t.get("gain"))
        else:
            raise ValueError(f"Unknown track type: {t["type"]}")
        tracks.append(track)
    song = Song(list(cfgs.values())[0], samples=samples)
    song.add_multipe_tracks(tracks)
    return song

def save_song(song, json_path="recent_song_info.json"):
    song_info = song.save_song()
    with open(json_path, "w") as f:
        json.dump(song_info, f, indent=2, default=str)

def merge_json(original, edited):
    if not isinstance(edited, dict):
        return edited
    merged = dict(original)
    for k, v in edited.items():
        if k == "Tracks" and isinstance(v, list) and isinstance(merged.get("Tracks"), list):
            # Merge tracks by name
            orig_tracks = {t["name"]: t for t in merged["Tracks"]}
            for t in v:
                orig_tracks[t["name"]] = merge_json(orig_tracks.get(t["name"], {}), t)
            merged["Tracks"] = list(orig_tracks.values())
        elif k in merged and isinstance(merged[k], dict) and isinstance(v, dict):
            merged[k] = merge_json(merged[k], v)
        else:
            merged[k] = v
    return merged

def llm_edit_song(song_json, instruction):
    structure_explanation = """
    
    - "samples": a dictionary mapping sample names to file paths or metadata.
    - "SynthConfigs": a list of synth settings, each with keys like "id", "sample_rate", "bpm", "volume", "waveform", "attack", "decay", "sustain", "release".
    - "Tracks": a list of tracks. Each track has:
        - "name": the track name
        - "cfg_id": the id of the SynthConfig it uses (links to a SynthConfig id)
        - "events": a list of [note, start, duration] triples. 
            - "note": the note or sample name (e.g., "C4" for Track or "kick" for WavTrack)
            - "start": the time (in beats) when the note or sample begins. For example, a start of 0 means the note starts at the very beginning, 1.5 means it starts halfway through the second beat, etc.
            - "duration": how many beats the note or sample lasts. Notes can overlap if their start and duration overlap.
        - "gain": the track's volume multiplier
        - "type": either "Track" (for synth/melody/chords) or "WavTrack" (for sample-based tracks; uses the corresponding sample by name)
    
    IMPORTANT: You are allowed to modify the "events" and "gain" fields of tracks, the parameters inside "SynthConfigs", and you may ADD new tracks if needed. 
    Do NOT remove tracks, samples, or change other fields. 
    Return ONLY the modified JSON. Always preserve all top-level fields in the JSON, including "samples", even if you do not modify them.
    """
    prompt = (
        structure_explanation +
        "\nHere is my song in JSON format:\n" +
        json.dumps(song_json, indent=2) +
        f"\nInstructions: {instruction}\nPlease return ONLY the modified JSON."
    )
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": "You are a helpful music assistant."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3,
        max_tokens=4096
    )
    content = response.choices[0].message.content
    # Try to extract JSON from the response
    try:
        # Remove code block markers if present
        content = re.sub(r"^```json|```$", "", content, flags=re.MULTILINE).strip()
        modified_json = json.loads(content)
    except Exception as e:
        raise ValueError(f"Could not parse LLM response as JSON: {e}\nResponse was:\n{content}")
    # Merge with original if not all fields are present
    if not all(k in modified_json for k in song_json):
        merged_json = merge_json(song_json, modified_json)
    else:
        merged_json = modified_json
    try:
        return load_song(data=merged_json)
    except Exception as e:
        print("Sorry, I could not load the modified song. The JSON I returned may be invalid or missing required fields.")
        print(f"Error details: {e}")
        print("Here is my response:\n", content)
        return Song(SynthConfig())

