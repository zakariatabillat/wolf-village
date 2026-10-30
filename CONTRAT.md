# Contexte commun + contrats des squads — Loup-Garou 3D

## Contexte commun (à coller en premier dans chaque conversation IA)

- **Projet** : jeu de Loup-Garou jouable dans le navigateur (HTML/CSS/JavaScript natif, modules ES). Scène 3D avec Three.js r160 (CDN jsDelivr + import map). Aucun framework, aucun build.
- **Joueurs** : 4 à 16, humains (même appareil, chacun son tour) ou IA. Noms fictifs uniquement, aucune donnée réelle.
- **Rôles** : `loup`, `villageois`, `voyante`, `sorciere`, `chasseur` (+ le maire, élu au jour 1).
- **Déroulé** : rôles → [nuit (loups → voyante → sorcière) → jour (annonce des morts) → maire (jour 1) → débat chronométré → vote] × N → fin.
- **Communication entre modules** : uniquement via le **bus d'événements** (`js/core/bus.js`), avec les noms de la constante `EVENTS`. Aucun module n'appelle directement l'interface ou la 3D.
- **Choix des joueurs** : chaque module demande une décision via `ask({ kind, player, candidates, context })` → `Promise<réponse>`. L'orchestrateur envoie la demande à un humain (panneau) ou à un bot. Le module ne sait pas lequel des deux répond.
- **Format d'un joueur** : `{ id: 'p1', name, role, alive, isBot, isMayor, color }`
- **État de la partie** : `{ players, phase, day, potions: { life, death }, lastWolfTarget, winner }`
- **Règle d'or** : chaque module expose au moins une **fonction pure** (sans DOM, sans hasard caché) testée dans `tests/cases.js`.

## Événements officiels

| Constante | Nom | Charge utile |
|---|---|---|
| GAME_START | `game:start` | `{ players }` |
| ROLES_ASSIGNED | `roles:assigned` | `{ players }` |
| PHASE_CHANGE | `phase:change` | `{ phase, day }` |
| NIGHT_WOLVES | `night:wolves` | `{ targetId }` (secret) |
| NIGHT_SEER | `night:seer` | `{ seerId, targetId, role }` (secret) |
| NIGHT_WITCH | `night:witch` | `{ witchId, saved, poisonedId }` (secret) |
| NIGHT_END | `night:end` | `{ deaths: [{ id, cause }] }` |
| PLAYER_DIED | `player:died` | `{ id, name, role, cause }` — cause ∈ loups, poison, vote, chasseur |
| MAYOR_ELECTED | `mayor:elected` | `{ id, counts, tie }` |
| MAYOR_SUCCESSOR | `mayor:successor` | `{ fromId, toId }` |
| DEBATE_START / TICK / END | `debate:*` | `{ duration }` / `{ remaining }` / `{ skipped }` |
| VOTE_CAST | `vote:cast` | `{ voterId, targetId }` (null = abstention) |
| VOTE_RESULT | `vote:result` | `{ eliminatedId, counts, tie, leaders, votes }` |
| HUNTER_SHOT | `hunter:shot` | `{ hunterId, targetId }` |
| CHAT | `chat:say` | `{ id, text, accuse?, asSeer? }` |
| GAME_OVER | `game:over` | `{ winner, survivors }` — winner ∈ village, loups, personne |

## Blocs des squads

| # | Module (fichier) | Reçoit | Renvoie | Émet | Stocke |
|---|---|---|---|---|---|
| 1 | Attribution des rôles (`modules/roles.js`) | `players[]`, `{ rng, bus }` | `{ ok, players }` ou `{ ok:false, error }` | `roles:assigned` | le rôle dans chaque joueur |
| 2 | Tour de nuit (`modules/night.js`) | `state, ask, bus` | `{ deaths }` | `night:wolves`, `night:seer`, `night:witch`, `night:end` | `state.potions`, `state.lastWolfTarget` |
| 3 | Vote du village (`modules/vote.js`) | `state, ask, bus` | `{ eliminatedId, counts, tie, leaders }` | `vote:cast`, `vote:result` | — |
| 4 | Maire (`modules/mayor.js`) | `state, ask, bus` | id du maire | `mayor:elected`, `mayor:successor` | `player.isMayor` |
| 5 | Chrono de débat (`modules/timer.js`) | `{ duration, bus, tickMs }` | `{ start, pause, resume, skip, addTime, remaining, done }` | `debate:start`, `debate:tick`, `debate:end` | temps restant |
| 6 | Écran de fin (`modules/endgame.js`) | `players[]` | `{ winner, wolves, others }` | `game:over` | `state.winner` |
| 7 | Journal d'événements (`modules/journal.js`) | `bus, getPlayer` | `{ entries, publicEntries, toText }` | — (écoute tout) | `entries[]` |
