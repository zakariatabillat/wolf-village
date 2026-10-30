# 🐺 Loup-Garou 3D — Une nuit à Brumeval

Jeu de Loup-Garou jouable en 3D dans le navigateur. JavaScript natif, modules ES, Three.js r160. Aucun build.

## Lancer (local + en ligne)

Il faut [Node.js](https://nodejs.org) 18 ou plus. **Aucun `npm install`** : le serveur n'a aucune dépendance.

```bash
cd loup-garou-3d
node server/server.js        # ou : npm start
```

Le terminal affiche deux adresses :
- `http://localhost:3000` → sur ton ordinateur
- `http://192.168.x.x:3000` → pour les autres appareils **sur le même Wi-Fi**

Il faut internet pour la 3D (Three.js vient du CDN). Sans connexion, le jeu passe tout seul en **mode 2D** et reste jouable.

## 🌐 Jouer en ligne

1. Lance le serveur (ci-dessus).
2. Toi : ouvre l'adresse, onglet **🌐 En ligne**, tape ton pseudo, **Créer une salle**. Un code à 4 lettres s'affiche (ex. `QNZY`).
3. Tes amis : ils ouvrent la même adresse sur leur téléphone ou leur ordi, onglet **En ligne**, pseudo + **code** puis **Rejoindre**. Tu peux aussi leur envoyer le lien `…/?salle=QNZY` : le code est pré-rempli.
4. Toi (l'hôte 👑) : ajoute des bots si vous êtes moins de 4, choisis la durée du débat, **Lancer la partie**.

Pendant la partie :
- chacun voit **son** rôle sur **son** écran (le serveur ne lui envoie jamais les rôles des autres) ;
- tout le monde vote **en même temps** ; 45 s maximum, sinon un choix automatique est fait ;
- le **chat** (📜) sert au débat. La nuit, seuls les loups peuvent chuchoter entre eux ;
- l'hôte contrôle le chrono (pause, +30 s, passer au vote) ;
- quelqu'un recharge la page ou perd le Wi-Fi ? Il revient à **sa place**. En attendant, un bot joue pour lui.

### Jouer à distance (pas sur le même Wi-Fi)

- **Tunnel rapide** (le jour J) : laisse le serveur tourner, puis dans un 2e terminal : `npx cloudflared tunnel --url http://localhost:3000`. Partage l'adresse `https://….trycloudflare.com` qui s'affiche.
- **Hébergement gratuit** : pousse le dossier sur GitHub, puis sur [Render](https://render.com) crée un *Web Service* Node avec *Start command* `node server/server.js`. Le port est lu dans `PORT` automatiquement.

### Si les autres n'arrivent pas à se connecter

- Windows : à la première exécution, autorise Node dans la fenêtre du pare-feu (**réseaux privés**).
- Vérifie que tout le monde est sur le **même Wi-Fi**. Certains Wi-Fi d'école isolent les appareils : utilise alors le tunnel.
- Utilise l'adresse `192.168…`, pas `localhost`, sur les autres appareils.

## Modes de jeu

- **Solo contre l'IA** : 1 humain + 7 bots qui débattent, s'accusent et votent.
- **Toute la squad** : 8 humains sur un seul écran, avec un rideau « passe l'appareil » pour les actions secrètes.
- **Démo (100 % IA)** : la partie se joue toute seule, rôles visibles. Idéal pour la restitution.
- **🌐 En ligne** : chacun sur son appareil, avec une salle et un code (voir plus bas).

## Structure

```
index.html            écran + import map Three.js
css/style.css         direction artistique
js/main.js            orchestrateur local : enchaîne les modules, route ask() vers humain/bot
js/online.js          client en ligne : affiche ce que le serveur envoie, renvoie les choix
js/ui/ask-panel.js    panneau de choix (partagé local / en ligne)
server/server.js      serveur Node : fichiers du jeu + WebSocket sur /ws
server/ws.js          mini WebSocket sans dépendance (RFC 6455)
server/room.js        salles, codes, hôte, reconnexion
server/game.js        partie en ligne : mêmes modules, ask() envoyé au bon navigateur
js/core/bus.js        bus d'événements + noms officiels (EVENTS)
js/core/state.js      forme de l'état et des joueurs
js/core/rng.js        hasard avec graine (tests reproductibles)
js/modules/roles.js   SQUAD 1 · attribution des rôles
js/modules/night.js   SQUAD 2 · tour de nuit
js/modules/vote.js    SQUAD 3 · vote du village
js/modules/mayor.js   SQUAD 4 · maire
js/modules/timer.js   SQUAD 5 · chrono de débat
js/modules/endgame.js SQUAD 6 · fin de partie
js/modules/journal.js SQUAD 7 · journal d'événements
js/ai/bots.js         cerveau des bots (suspicion, répliques)
js/scene/scene3d.js   village 3D (feu, maisons, forêt, jour/nuit, personnages)
js/ui/ui.js           DOM : panneaux, cartes, journal, écran de fin
js/ui/audio.js        narrateur vocal + ambiance synthétisée
tests/                1 scénario nominal + des cas limites par module
CONTRAT.md            contexte commun + contrats d'interface
prompts/              prompts JSON pour ChatGPT et Claude
```

## Tests (étape 3)

- Navigateur : ouvrir `tests/index.html`
- Terminal : `node tests/run-node.mjs` → **28/28**

Les cas limites demandés sont couverts : 1 seul joueur, égalité de votes (avec et sans maire), tous les loups éliminés, abstention générale, poison sur la victime des loups, chrono à 0 s, double `skip()`.

## Extrait à expliquer sans IA : `tallyVotes` (vote.js)

```js
export function tallyVotes(votes, { mayorId = null } = {}) {
  const counts = {};
  for (const { voterId, targetId } of votes) {
    if (!targetId) continue;                        // 1. abstention : on ignore
    const weight = voterId === mayorId ? 2 : 1;      // 2. le maire compte double
    counts[targetId] = (counts[targetId] ?? 0) + weight;
  }
  const max = Math.max(0, ...Object.values(counts)); // 3. score le plus haut (0 si aucun vote)
  const leaders = max === 0 ? [] : Object.keys(counts).filter(id => counts[id] === max);
  return {
    counts,
    leaders,                                          // 4. tous les joueurs à égalité en tête
    tie: leaders.length > 1,
    eliminatedId: leaders.length === 1 ? leaders[0] : null, // 5. un seul en tête → éliminé
  };
}
```

## Déboguer pendant la démo

Console : chaque événement du bus s'affiche en orange. `lg.state()`, `lg.journal()`.

## Comment marche le mode en ligne (à expliquer à l'oral)

Le serveur est l'**arbitre** : la partie tourne chez lui, avec **exactement les mêmes modules** que le mode local. La seule différence, c'est la fonction `ask()`. En local, elle ouvre un panneau sur l'écran. En ligne, elle envoie un message `ask` au navigateur du joueur et attend sa réponse `answer`. Les modules des squads ne voient pas la différence : c'est l'intérêt du contrat d'interface.

```
navigateur de Sara  ──{ type:'answer', askId, value:'p3' }──▶  serveur (vérifie la réponse)
navigateur de Sara  ◀──{ type:'ask', kind:'vote', candidates }──  serveur (runVote → ask)
tous les navigateurs ◀──{ type:'view', op:'kill', id, role }───  serveur (processDeaths)
```
