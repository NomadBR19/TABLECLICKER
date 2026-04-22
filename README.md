# Table Clicker

Petit jeu web clicker + casino connecte a une table commune sur le reseau local.

## Lancer

```powershell
python server.py
```

Ouvre ensuite:

```text
http://localhost:8000
```

Pour jouer avec d'autres personnes du meme reseau local, donne l'adresse IP de ce PC avec le port `8000`, par exemple:

```text
http://192.168.1.42:8000
```

Le serveur ecoute sur `0.0.0.0:8000`, donc il est accessible depuis les interfaces reseau de ce PC. Il n'est pas publie automatiquement sur Internet, sauf si la box, un VPN, un tunnel ou une redirection de port l'expose.

## Table reseau unique

Il n'y a pas de salons ni d'invitations.

Tous les joueurs qui ouvrent le site depuis le meme serveur rejoignent automatiquement la meme table reseau:

- les joueurs connectes sont visibles dans la colonne de droite;
- le chat de table reste lisible depuis tout le site;
- le journal affiche les actions et resultats importants;
- il n'y a plus de cagnotte commune ni de taxe sur les gains.

## Jeux

- Clique le jeton pour generer des jetons.
- Achete des ameliorations pour augmenter le clic et les revenus automatiques.
- Joue a la roulette et au blackjack; les resultats sont annonces a la table reseau.
- Le poker Texas Hold'em est affiche avec les autres jeux.

## Roulette fantome

L'amelioration `Croupier fantome` est une amelioration tardive tres chere:

- cout de base: `250 000` jetons;
- multiplicateur de prix: `x2.35` par niveau;
- bonus passif: `+750 jetons/s` par niveau;
- debloque un panneau `Roulette fantome` dans la roulette.

Quand elle est achetee, tu peux activer une mise automatique sur rouge ou noir. La mise minimale est de `100` jetons et le bouton `All in` n'est jamais utilise par l'automatisation. Le niveau 1 lance une roulette toutes les 60 secondes; chaque niveau reduit le delai de 7,5 secondes, avec un minimum de 30 secondes.

Pour participer au poker, chaque joueur doit cliquer sur `Pret pour le poker` avec sa mise. La main demarre automatiquement quand au moins 2 joueurs sont prets.

Le poker se joue ensuite tour par tour:

- preflop: chaque joueur voit ses 2 cartes;
- flop, turn, river: le board est revele progressivement;
- a chaque phase, les joueurs encore actifs doivent choisir `Rester` ou `Se coucher`;
- si tout le monde sauf un joueur se couche, ce joueur gagne directement;
- si plusieurs joueurs restent jusqu'a la river, le serveur compare les mains et verse le pot au gagnant.

## Sauvegarde

La progression est sauvegardee dans le navigateur avec `localStorage`.

Le serveur garde les joueurs connectes, la table, le chat et les derniers evenements en memoire seulement pendant qu'il tourne. Si tu arretes `server.py`, l'etat multijoueur est reinitialise.
