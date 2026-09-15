import type { BdAudio, BdSong } from "../types/bd";
import type { AudioQuality, Track } from "../types/player";

const PLAYABLE_AUDIO_LEVELS: Record<string, number> = {
  "aac:48": 0,
  "ogg:100": 0,
  "mp3:128": 0,
  "ogg:192": 1,
  "ogg:300": 2,
  "mp3:320": 2,
  "flac:2000": 3,
};

export const selectBdAudio = (
  audios: readonly BdAudio[],
  level: "lq" | "sq" | "hq" | "lossless" | "hi-res",
): BdAudio | undefined => {
  const target = { lq: 0, sq: 1, hq: 2, lossless: 3, "hi-res": 3 }[level];
  const playable = audios
    .map((audio) => ({ format: audio.format.toLowerCase(), bitrate: Number(audio.bitrate) }))
    .filter((audio) => Object.hasOwn(PLAYABLE_AUDIO_LEVELS, `${audio.format}:${audio.bitrate}`))
    .sort((left, right) => left.bitrate - right.bitrate);
  for (let index = playable.length - 1; index >= 0; index -= 1) {
    const audio = playable[index];
    if (PLAYABLE_AUDIO_LEVELS[`${audio.format}:${audio.bitrate}`] <= target) return audio;
  }
  return playable[0];
};

export const bdSongToTrack = (song: BdSong): Track => {
  const audios = (song.audios ?? []).map(({ format, bitrate }) => ({ format, bitrate }));
  const bestAudio = selectBdAudio(audios, "lossless");
  const quality: AudioQuality | undefined = bestAudio
    ? {
        codec: bestAudio.format,
        bitRate: Number(bestAudio.bitrate) * 1000,
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
      }
    : undefined;
  const cover = song.albumPic120 || song.albumPic || undefined;
  return {
    id: String(song.id),
    source: "bd",
    title: song.name || song.songName || "",
    artists: song.artists?.length
      ? song.artists.map((artist) => ({
          id: artist.id == null ? undefined : String(artist.id),
          name: artist.name,
          avatar: artist.pic,
        }))
      : song.artist
        ? [
            {
              id: song.artistId == null ? undefined : String(song.artistId),
              name: song.artist,
              avatar: song.artistPic,
            },
          ]
        : [],
    album:
      song.album || song.albumId != null
        ? {
            id: song.albumId == null ? undefined : String(song.albumId),
            name: song.album ?? "",
            cover,
          }
        : undefined,
    duration: Math.max(0, Number(song.duration) || 0) * 1000,
    cover,
    coverOriginal: song.albumPic || cover,
    quality,
    bd: { audios, freeSign: song.freeSign || song.fsig || undefined },
  };
};
