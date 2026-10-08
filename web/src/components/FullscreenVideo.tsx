import { useEffect, useRef, useState } from 'react';
import type { PresentationVideoDTO } from '@gt/shared';

export default function FullscreenVideo({ video }: { video: PresentationVideoDTO }) {
  const [failed, setFailed] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.muted = false;
    void element.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true));
  }, [video.url]);

  const enablePlayback = async () => {
    const element = videoRef.current;
    if (!element) return;
    element.muted = false;
    setMuted(false);
    try {
      await element.play();
      setNeedsGesture(false);
      setFailed(false);
    } catch {
      setNeedsGesture(true);
    }
  };

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
        const element = videoRef.current;
        if (!element) return;
        element.muted = false;
        void element.play().catch(() => setNeedsGesture(true));
      }}
      onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
    />
    {failed && <p role="alert" className="absolute bottom-6 rounded-lg bg-black/80 px-4 py-3 text-center text-sm text-white">Video konnte nicht wiedergegeben werden. Bitte MP4 und Codec überprüfen.</p>}
    <div className="absolute bottom-4 right-4 flex items-center gap-2 sm:bottom-6 sm:right-6">
      {needsGesture && <button type="button" className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 shadow-xl" onClick={() => void enablePlayback()}>▶ Video mit Ton starten</button>}
      <button type="button" className="rounded-lg bg-black/75 px-3 py-2 text-xs font-bold text-white sm:text-sm" onClick={async () => {
        const element = videoRef.current;
        if (!element) return;
        if (element.muted) {
          await enablePlayback();
        } else {
          element.muted = true;
          setMuted(true);
        }
      }}>{muted ? 'Ton aktivieren' : 'Ton ausschalten'}</button>
    </div>
  </main>;
}
