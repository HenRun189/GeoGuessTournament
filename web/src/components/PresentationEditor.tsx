import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import type { PresentationDeckDTO, TournamentStateDTO } from '@gt/shared';

interface Props {
  state: TournamentStateDTO;
  decks: PresentationDeckDTO[];
  setDecks: Dispatch<SetStateAction<PresentationDeckDTO[]>>;
  decksLoaded: boolean;
  selectedDeckId: string;
  active: boolean;
  onSave: () => Promise<void>;
  onSelect: (deckId: string) => void;
  onStart: (deckId: string) => Promise<void>;
  onDeleteDeck: (deckId: string) => Promise<void>;
}

const uid = () => `slide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function PresentationEditor({ state, decks, setDecks, decksLoaded, selectedDeckId, active, onSave, onSelect, onStart, onDeleteDeck }: Props) {
  const deck = decks.find((item) => item.id === selectedDeckId) ?? decks[0];
  const [error, setError] = useState<string | null>(null);
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

  return <section className="card space-y-3" aria-label="Präsentationen verwalten">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-bold uppercase tracking-wider text-emerald-300">Präsentation & Ergebnisanzeige</h2><p className="text-xs text-slate-400">Foliensätze, Reihenfolge, Titel, Text und optionale Bild-URL verwalten.</p></div>
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
    {error && <div role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
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
    {active && <p className="text-sm font-bold text-emerald-300">Live aktiv: {state.presentation.currentIndex + 1}/{deck?.slides.length ?? 0} · ZURÜCK / WEITER / PRÄSENTATION BEENDEN stehen oben in der Adminseite; Escape beendet sofort.</p>}
  </section>;
}
