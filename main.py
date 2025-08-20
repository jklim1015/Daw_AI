import argparse
from song_manager import load_song, save_song, llm_edit_song
from seq import Song, Track, WavTrack, SynthConfig, load_wav


def main(args):
    song_history = []
    if args.load is not None:
        song = load_song(path=args.load)
    else:
        """
        new_track = True
        cfgs = []
        while new_track:
            print("Creating new song:")
        """
        samples = {"kick": "/Users/joshlim/Desktop/kick_test.wav"}
        cfg = SynthConfig(bpm=96, waveform="saw")
        drums = WavTrack("kick", cfg, "/Users/joshlim/Desktop/kick_test.wav", gain=1).add("kick",0,2).add("kick",2,2)
        mel = Track("melody", cfg, gain=1).add("C4",0,1).add("C4",0.5,1).add("D4",1,1).add("Eb4",2,1).add("G4",3,1)
        chd = Track("chords", cfg, gain=1).add("C3+E3+G3",0,2).add("F3+A3+C4",2,2)
        song = Song(cfg, samples=samples).add_track(chd).add_track(mel).add_track(drums)
    song_history.append(song)
    print("Playing new song:")
    song.play()
    while True:
        change = input("Would you like to edit the song? [y/n] ")
        if change != 'y':
            break
        prompt = input("What would you like to change? ")
        song = llm_edit_song(song.save_song(), prompt)
        print("Playing new song:")
        song.play()
        revert = input("Would you like to revert back to the previous version? [y/n] ")
        if revert == 'y':
            song = song_history[-1]
        else:
            song_history.append(song)
    save = input("Would you like to save the song? [y/n] ")
    #Finish later
    
            





if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create or load a song")
    parser.add_argument("--out", type=str, required=True, help="Path to song save destination.")
    parser.add_argument("--name", type=str, default=None, help="Name for song.")
    parser.add_argument("--load", type=str, default=None, help="Path to load song json file.")
    args = parser.parse_args()
    main(args)