# The DM's Perspective — suite home

This repository is the front page of thedmsperspective.github.io and the home of the **suite core**, the shared piece every app on the site loads.

## Apps on this site

- [Bestiary](https://thedmsperspective.github.io/Bestiary/)
- [Character Sheet](https://thedmsperspective.github.io/Char-Sheet/)
- [Session Notes](https://thedmsperspective.github.io/Session-Notes/)
- [Magic Items](https://thedmsperspective.github.io/Magic-Items/)

## Suite core (`core/suite.js`)

Phase 1 — shared Google sign-in. Sign in once in any app and the others use that sign-in instead of asking again. It's only handed to an app that needs no more permissions than it carries, and never to an app that last synced with a different Google account. Every app falls back to its own sign-in if the core can't load.

Also in the core: shared campaigns and current campaign, the party (Character Sheet characters by permanent ID), table settings and each campaign's in-game clock (`suite.js`); the live link over Firebase with a secret key per character (`live.js`, add `#livelog` to any app's address to see it work); and the rules for what a player's sheet shows from each app (`views.js`).

## The launcher (`index.html`)

The site's front page: one Google sign-in for every app, the current campaign switch for every app, and a die for each app.
