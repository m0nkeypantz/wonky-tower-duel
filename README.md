# Wonky Tower

A tiny two-player mobile browser stacking game inspired by wobbly cube party games.

## How it works
- Open the GitHub Pages URL. The first browser becomes the host.
- Tap **Invite Sabrina** and send the generated room URL.
- The guest opens that URL and connects directly through PeerJS/WebRTC.
- Players alternate drawing a card and placing a matching cube.
- The tower uses a deterministic center-of-mass stability check. Whoever knocks it down loses.

No database, login, or persistent room is required. The host page must remain open during the match.
