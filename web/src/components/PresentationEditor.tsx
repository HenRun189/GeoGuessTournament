import type { Dispatch, SetStateAction } from 'react';
import { useRef, useState } from 'react';
import type { PresentationDeckDTO, PresentationVideoDTO, TournamentStateDTO } from '@gt/shared';

interface Props {
  state: TournamentStateDTO;
  decks: PresentationDeckDTO[];
  setDecks: Dispatch<SetStateAction<PresentationDeckDTO[]>>;
  decksLoaded: boolean;
  selectedDeckId: string;
  active: boolean;
  video: PresentationVideoDTO | null;
  onUploadVideo: (file: File) => Promise<void>;
  onSetVideoActive: (active: boolean) => Promise<void>;
  onSave: () => Promise<void>;
  onSelect: (deckId: string) => void;
  onStart: (deckId: string) => Promise<void>;
  onDeleteDeck: (deckId: string) => Promise<void>;
}

const uid = () => `slide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function PresentationEditor({ state, decks, setDecks, decksLoaded, selectedDeckId, active, video, onUploadVideo, onSetVideoActive, onSave, onSelect, onStart, onDeleteDeck }: Props) {
  const deck = decks.find((item) => item.id === selectedDeckId) ?? decks[0];
  const [collapsed, setCollapsed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Aktion fehlgeschlagen'); }
  };
  const removeDeck = async (deckId: string) => {
    setError(null);
    try { await onDeleteDeck(deckId); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Aktion fehlgeschlagen'); }
  };
  const updateDeck = (deckId: string, update: (deck: PresentationDeckDTO) => PresentationDeckDTO) => setDecks((all) => all.map((item) => item.id === deckId ? update(item) : item));
  const updateSlide = (slideId: string, patch: Partial<PresentationDeckDTO['slides'][number]>) => deck && updateDeck(deck.id, (item) => ({ ...item, slides: item.slides.map((slide) => slide.id === slideId ? { ...slide, ...patch } : slide) }));

  const handleVideoFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.mp4') || (file.type && file.type !== 'video/mp4')) {
      setError('Bitte eine MP4-Datei auswählen.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('Das MP4-Video darf höchstens 100 MB groß sein.');
      return;
    }
    setVideoBusy(true);
    setError(null);
    try {
      await onUploadVideo(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Video konnte nicht hochgeladen werden');
    } finally {
      setVideoBusy(false);
    }
  };

  return <section className={`rounded-xl border border-slate-800 bg-slate-900/70 ${collapsed ? 'p-2' : 'p-4'}`} aria-label="Präsentationen verwalten">
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-2">
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((open) => !open)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
        <span className="min-w-0"><span className="block truncate text-sm font-bold uppercase tracking-wider text-emerald-300">Präsentation & Ergebnisanzeige</span><span className="block truncate text-xs text-slate-400">{deck?.title ?? 'Foliensätze verwalten'} · {deck?.slides.length ?? 0} Folien{active ? ' · LIVE' : ''}</span></span>
        <span aria-hidden="true" className="px-2 text-slate-400">{collapsed ? '⌄' : '⌃'}</span>
      </button>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="btn-secondary cursor-pointer px-3 py-1.5 text-xs" title="MP4 auswählen und auf allen Ausgaben abspielen">{videoBusy ? 'Lädt…' : video?.active ? 'MP4 wechseln' : video ? 'MP4 wechseln' : 'MP4 auswählen'}<input ref={fileInput} className="hidden" type="file" accept="video/mp4,.mp4" disabled={videoBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void handleVideoFile(file); }} /></label>
        {video?.url && <button type="button" className={video.active ? 'btn-danger px-3 py-1.5 text-xs' : 'btn-primary px-3 py-1.5 text-xs'} disabled={videoBusy} onClick={() => void run(() => onSetVideoActive(!video.active))}>{video.active ? 'MP4 stoppen' : 'MP4 abspielen'}</button>}
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" aria-label="Präsentationseditor umschalten" onClick={() => setCollapsed((open) => !open)}>{collapsed ? 'Öffnen' : 'Schließen'}</button>
      </div>
    </div>
    {error && <div role="alert" className="mt-2 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
    {video?.active && <p role="status" className="mt-2 text-xs font-semibold text-amber-300">MP4 läuft fullscreen auf den Präsentations- und Stream-Ausgaben. Beenden jederzeit mit „MP4 stoppen“.</p>}
    {!collapsed && <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-slate-400">Foliensätze, Reihenfolge, Titel, Text und optionale Bild-URL verwalten.</div>
      <button className="btn-secondary" disabled={!decksLoaded} onClick={() => {
        const newDeck = { id: uid(), title: 'Neue Präsentation', slides: [{ id: uid(), title: 'Neue Folie', text: 'Folientext hier eingeben.', imageUrl: null }] };
        setDecks((all) => [...all, newDeck]);
        onSelect(newDeck.id);
      }}>+ Präsentation</button>
    </div>
    <div className="flex flex-wrap gap-2">
      <label className="sr-only" htmlFor="presentation-deck">Foliensatz auswählen</label>
      <select id="presentation-deck" className="input min-w-48 flex-1" disabled={!decksLoaded || !deck} value={deck?.id ?? ''} onChange={(event) => onSelect(event.target.value)}>
        {decks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      {deck && <button className="btn-danger px-3" disabled={decks.length <= 1} onClick={() => void removeDeck(deck.id)}>Präsentation löschen</button>}
    </div>
    {deck && <>
      <label className="label" htmlFor="deck-title">Name der Präsentation</label>
      <input id="deck-title" className="input" value={deck.title} onChange={(event) => updateDeck(deck.id, (item) => ({ ...item, title: event.target.value }))} maxLength={160} />
      <div className="space-y-3">
        {deck.slides.map((slide, index) => <article key={slide.id} className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-xs uppercase tracking-wider text-slate-400">Folie {index + 1} von {deck.slides.length}</strong><div className="flex gap-1"><button className="btn-ghost px-2" aria-label={`Folie ${index + 1} nach oben`} disabled={index === 0} onClick={() => updateDeck(deck.id, (item) => { const slides = [...item.slides]; [slides[index - 1], slides[index]] = [slides[index], slides[index - 1]]; return { ...item, slides }; })}>↑</button><button className="btn-ghost px-2" aria-label={`Folie ${index + 1} nach unten`} disabled={index === deck.slides.length - 1} onClick={() => updateDeck(deck.id, (item) => { const slides = [...item.slides]; [slides[index + 1], slides[index]] = [slides[index], slides[index + 1]]; return { ...item, slides }; })}>↓</button><button className="btn-danger px-2" disabled={deck.slides.length <= 1} onClick={() => updateDeck(deck.id, (item) => ({ ...item, slides: item.slides.filter((entry) => entry.id !== slide.id) }))}>Entfernen</button></div></div>
          <label className="label" htmlFor={`${slide.id}-title`}>Titel</label><input id={`${slide.id}-title`} className="input mb-2" value={slide.title} maxLength={160} onChange={(event) => updateSlide(slide.id, { title: event.target.value })} />
          <label className="label" htmlFor={`${slide.id}-text`}>Text</label><textarea id={`${slide.id}-text`} className="input min-h-24 mb-2" value={slide.text} maxLength={3000} onChange={(event) => updateSlide(slide.id, { text: event.target.value })} />
          <label className="label" htmlFor={`${slide.id}-image`}>Bild-URL (optional)</label><input id={`${slide.id}-image`} type="url" className="input" value={slide.imageUrl ?? ''} placeholder="https://…" maxLength={2048} onChange={(event) => updateSlide(slide.id, { imageUrl: event.target.value || null })} />
        </article>)}
      </div>
      <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => updateDeck(deck.id, (item) => ({ ...item, slides: [...item.slides, { id: uid(), title: 'Neue Folie', text: '', imageUrl: null }] }))}>+ Folie</button>
        <button className="btn-primary" disabled={!decksLoaded} onClick={() => void run(onSave)}>PRÄSENTATIONEN SPEICHERN</button>
        <button className="btn-primary" disabled={!decksLoaded || !deck.slides.length} onClick={() => void run(() => onStart(deck.id))}>{active ? 'PRÄSENTATION ERNEUT STARTEN' : 'PRÄSENTATION STARTEN'}</button>
      </div>
    </>}
    {active && <p className="text-sm font-bold text-emerald-300">Live aktiv: {state.presentation.currentIndex + 1}/{deck?.slides.length ?? 0} · Navigation und Beenden bleiben oben in der Adminseite verfügbar.</p>}
    </div>}
  </section>;
}
