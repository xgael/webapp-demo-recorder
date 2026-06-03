/**
 * music.ts — background music helpers for demo videos.
 *
 *   1. generateBackgroundMusic() — generate a track with ElevenLabs' Music model.
 *   2. mixMusicUnder()           — mix a track UNDER the video's audio (ffmpeg),
 *                                  so a voiceover stays clearly on top.
 *
 * The API key is read from the environment (ELEVENLABS_API_KEY) — never hardcode it.
 *
 * Example:
 *   import { generateBackgroundMusic, mixMusicUnder } from "../scripts/music";
 *   await generateBackgroundMusic({
 *     prompt: "Sleek minimal corporate-tech score, soft synth pads, gentle pulse, instrumental",
 *     lengthMs: 60000,
 *     output: "/tmp/bg.mp3",
 *   });
 *   mixMusicUnder({ video: "demo.mp4", music: "/tmp/bg.mp3", output: "demo-music.mp4", volume: 0.22 });
 */
import { execFileSync } from "child_process";
import { writeFileSync } from "fs";

const ELEVEN_MUSIC_URL = "https://api.elevenlabs.io/v1/music";

export interface MusicOptions {
  /** Free-text description of the track. Be specific about mood, instrumentation and that it should leave room for a voiceover. */
  prompt: string;
  /** Track length in ms. Default 60000. */
  lengthMs?: number;
  /** Output mp3 path. */
  output: string;
  /** ElevenLabs API key. Default: process.env.ELEVENLABS_API_KEY. */
  apiKey?: string;
}

/** Generate a background-music track with ElevenLabs' Music model. Returns the output path. */
export async function generateBackgroundMusic(opts: MusicOptions): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY (set env var or pass opts.apiKey)");
  const res = await fetch(ELEVEN_MUSIC_URL, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ prompt: opts.prompt, music_length_ms: opts.lengthMs ?? 60000 }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs Music ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(opts.output, buf);
  return opts.output;
}

export interface MixOptions {
  /** Video whose existing audio (e.g. the voiceover) should stay on top. */
  video: string;
  /** Music track to place underneath. */
  music: string;
  /** Output path. */
  output: string;
  /** Music gain, 0–1. Default 0.22 (subtle background under narration). */
  volume?: number;
  /** Fade-in seconds. Default 1.5. */
  fadeInSec?: number;
  /** When the fade-out starts. Default: video duration − 2. */
  fadeOutStartSec?: number;
  /** Fade-out duration. Default 2. */
  fadeOutDurSec?: number;
}

/**
 * Mix `music` under the video's audio with ffmpeg. The video's own track keeps
 * full level (normalize=0); the music is attenuated and fades in/out, so a
 * voiceover stays intelligible. Returns the output path.
 */
export function mixMusicUnder(opts: MixOptions): string {
  const vol = opts.volume ?? 0.22;
  const fin = opts.fadeInSec ?? 1.5;
  const dur = ffprobeDuration(opts.video);
  const foStart = opts.fadeOutStartSec ?? Math.max(0, dur - 2);
  const foDur = opts.fadeOutDurSec ?? 2;
  const filter =
    `[1:a]volume=${vol},afade=t=in:st=0:d=${fin},afade=t=out:st=${foStart}:d=${foDur}[bg];` +
    `[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]`;
  execFileSync(
    "ffmpeg",
    [
      "-y", "-i", opts.video, "-i", opts.music,
      "-filter_complex", filter,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      opts.output,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return opts.output;
}

function ffprobeDuration(file: string): number {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]).toString().trim();
  return parseFloat(out) || 0;
}
