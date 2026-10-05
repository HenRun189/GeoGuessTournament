import { Link, useSearchParams } from 'react-router-dom';
import { DISCORD_HELP_TEXT } from '@gt/shared';
import { useTournamentState } from '../lib/api';

export default function RulesPage() {
  const [params] = useSearchParams();
  const tournamentId = params.get('turnier');
  const { state } = useTournamentState(tournamentId);
  const formatText = state
    ? state.format === 'groups_of_3'
      ? 'Es gibt zwei Gruppen mit je drei Spielern oder Teams. Innerhalb jeder Gruppe spielt jede Seite einmal gegen jede andere. Die ersten beiden jeder Gruppe ziehen weiter: Platz 1 aus Gruppe A spielt gegen Platz 2 aus Gruppe B und umgekehrt. Die beiden Gruppendritten scheiden aus.'
      : state.format === 'random_three'
        ? 'Jede Person spielt gegen drei zufällig zugeteilte Gegner. Bei ungerader Teilnehmerzahl hat eine Person spielfrei und bestreitet zwei statt drei Vorrundenspiele. Die besten vier ziehen ins Halbfinale ein.'
        : 'In der Vorrunde spielt jede Person bzw. jedes Team gegen alle anderen. Die besten vier ziehen ins Halbfinale ein.'
    : 'Bei 4 und 5 Teilnehmenden spielt jede Person gegen alle anderen. Bei 6 sowie 12 (also 6 Teams) gibt es zwei Gruppen mit je drei Einheiten. Bei 7, 9 und 11 Teilnehmenden werden drei zufällige Gegner pro Person ausgelost; bei ungerader Zahl hat eine Person eine Freirunde und spielt zweimal. Bei 8 und 10 Personen treten Zweierteams in einer Rundenvorrunde an. Die vier Besten bzw. die zwei Besten jeder Gruppe erreichen das Halbfinale.';

  return <main className="mx-auto max-w-3xl px-4 py-8">
    <Link to="/" className="btn-ghost mb-5">← Startseite</Link>
    <h1 className="mb-2 text-3xl font-black">Turnierregeln & Erklärung</h1>
    {state && <p className="mb-5 text-sm text-slate-400">{state.name} · {state.participantCount} Teilnehmende{state.unitKind === 'team' ? ` · ${state.units.length} Zweierteams` : ''}</p>}
    <div className="space-y-4">
      <section className="card"><h2 className="mb-2 font-bold text-emerald-300">Ablauf dieses Turniers</h2><p className="text-sm leading-6 text-slate-300">{formatText}</p><p className="mt-2 text-sm leading-6 text-slate-300">Im Halbfinale spielen die bestplatzierten vier (oder die beiden Gruppenersten und -zweiten) gegeneinander. Die Sieger erreichen das Finale; dessen Sieger gewinnt das Turnier.</p></section>
      <section className="card"><h2 className="mb-2 font-bold text-emerald-300">Matches und Spielplan</h2><p className="text-sm leading-6 text-slate-300">Die Spielleitung aktiviert jeweils ein Match. Sobald ein gültiges Ergebnis eingetragen ist, wird automatisch das nächste geplante offene Spiel aktiviert. Die Spielleitung kann auch ein anderes kommendes Match sofort auswählen. Deine persönliche Spielerseite zeigt deinen nächsten Gegner, den eigenen Spielplan, Ergebnisse und wie viele Spiele vorher noch anstehen.</p></section>
      <section className="card"><h2 className="mb-2 font-bold text-emerald-300">Bereitschaft melden</h2><p className="text-sm leading-6 text-slate-300"><strong>BEREIT</strong> heißt: Du bist körperlich bereit, dein Match zu starten. <strong>IN GEOGUESSR</strong> heißt: Du bist bereits im GeoGuessr-Spiel und kannst losspielen. Das sind Statusmeldungen für die Spielleitung und ändern den Spielplan nicht.</p></section>
      <section className="card"><h2 className="mb-2 font-bold text-emerald-300">Rangliste und Schaden</h2><ol className="list-inside list-decimal space-y-1 text-sm text-slate-300"><li>Mehr Siege stehen weiter oben.</li><li>Bei gleicher Siegzahl entscheidet mehr verursachter Schaden.</li><li>Ist auch der verursachte Schaden gleich, zählt weniger erlittener Schaden.</li></ol><p className="mt-2 text-sm text-slate-400">Schaden genommen wird aus dem Schaden abgeleitet, den die Gegenseite verursacht hat.</p></section>
      <section className="card"><h2 className="mb-2 font-bold text-emerald-300">Hilfe bei Problemen</h2><p className="text-sm leading-6 text-slate-300">Über „PROBLEM / HILFE“ kannst du der Spielleitung eine kurze Problemmeldung senden. Das ist kein Chat. Für weitere Hilfe bitte im Discord im Event-Server im Kanal #probleme melden.</p></section>
    </div>
  </main>;
}
