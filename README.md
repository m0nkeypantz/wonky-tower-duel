# Wonky Tower v2

Mobile-first browser stacking game with two modes:

- **Solo Stack**: score attack, combo/bravery bonuses, persistent solo run and best score.
- **VS Duel**: server-authoritative two-player rooms with invite links and reconnect-safe state.

## Stack
- Node.js + Express
- Socket.IO multiplayer
- Vanilla HTML/CSS/JS
- CSS 3D cubes, card flip/pull animations, confetti, synthesized sound, optional haptics

## Room persistence
Rooms and their current game state live on the server for up to two hours after everyone disconnects. Host and guest player IDs are stored locally so refreshing or briefly leaving the page reconnects to the same seat and state.

## Run
```bash
npm install
npm start
```
Default port: 3000.

## Production
Deployed through Joey's Ella VPS webapp platform at:
https://wonky-tower.74.208.245.9.nip.io
