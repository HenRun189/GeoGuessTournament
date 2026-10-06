import { useRef, useState } from 'react';
import type { PresentationVideoDTO } from '@gt/shared';

export default function FullscreenVideo({ video }: { video: PresentationVideoDTO }) {
  const [failed, setFailed] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  return <main className="fixed inset-0 z-50 flex h-screen h-dvh w-screen items-center justify-center overflow-hidden bg-black" aria-label="MP4-Wiedergabe">
    <video
      key={video.url}
      ref={videoRef}
      className="h-full w-full object-contain"
      src={video.url}
      autoPlay
      muted={muted}
      loop
      playsInline
      controls={false}
      preload="auto"
      onError={() => setFailed(true)}
      onPlay={() => { setFailed(false); setNeedsGesture(false); }}
      onCanPlay={() => {
        setFailed(false);
        void videoRef.current?.play().catch(() => setNeedsGesture(true));
      }}
    />
    {failed && <p role="alert" className="absolute bottom-6 rounded-lg bg-black/80 px-4 py-3 text-center text-sm text-white">Video konnte nicht wiedergegeben werden. Bitte MP4 und Codec überprüfen.</p>}
    <button type="button" className="absolute bottom-4 right-4 rounded-lg bg-black/75 px-3 py-2 text-xs font-bold text-white sm:bottom-6 sm:right-6 sm:text-sm" onClick={() => { if (needsGesture) void videoRef.current?.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true)); setMuted((value) => !value); }}>{needsGesture ? 'Video starten' : muted ? 'Ton aktivieren' : 'Ton ausschalten'}</button>
  </main>;
}
