declare module "soundtouchjs" {
  export class SoundTouch { tempo: number; pitch: number; rate: number; }
  export class WebAudioBufferSource { constructor(buffer: AudioBuffer); }
  export class SimpleFilter { constructor(source: unknown, pipe: SoundTouch); extract(target: Float32Array, numFrames: number): number; }
}
declare module '*.css';
