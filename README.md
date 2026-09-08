# Wonky Tower Duel v3

A mobile-first browser stacking game inspired by physical wonky-block party games.

## Game modes
- **Solo Stack**: four-card hand, choose a playable block card, drag the matching 3D block onto the tower, survive a real-time physics settle, chase score/combo/bravery bonuses.
- **VS Duel**: persistent server rooms, four-card hands, card replacement in the same hand slot, action cards, combo cards, reconnect-safe state, and a nine-block instant-win condition.

## Card system
Each player always sees four cards. Playing one immediately replaces only that card slot with a fresh card. Other cards remain in hand. Stack cards can target a color, a size, an exact block, or any block. VS also includes Pass, Skip, Scramble combo, and Power Play combo cards.

## Tower rules
There are nine blocks: three colors and three sizes. Blocks are rendered with Three.js as rounded, asymmetrical 3D shapes. Dragging is direct touch/pointer control. Cannon-es handles gravity, collisions, friction, center-of-mass bias, wobble and settling. After a block is released, the game performs a three-second stability count before ending the turn.

## Multiplayer persistence
VS state is authoritative on the Node/Socket.IO server. Rooms survive refreshes and brief disconnects for up to 12 hours after the last activity. The host and guest keep the same seat through local player IDs and the room URL.

## Stack
- Node.js + Express
- Socket.IO
- Three.js
- cannon-es
- Vanilla HTML/CSS/JS

## Production
https://wonky-tower.74.208.245.9.nip.io
