export {};

declare global {
  interface Window {
    tapo?: {
      health: () => Promise<{ ffmpeg: boolean }>;
      connect: (payload: { email: string; password: string; code?: string }) => Promise<{
        ok: boolean;
        mfa?: boolean;
        error?: string;
        cameras?: { id: string; name: string; model: string; host: string }[];
      }>;
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
