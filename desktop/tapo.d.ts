export {};

declare global {
  interface Window {
    tapo?: {
      health: () => Promise<{ ffmpeg: boolean }>;
      stop: (host: string) => Promise<{ stopped?: boolean }>;
      play: (payload: {
        host: string;
        password: string;
        passwordIsHash: boolean;
        volume: number;
        file: Uint8Array;
      }) => Promise<{ durationMs?: number; truncated?: boolean }>;
    };
  }
}
