# The DM's Perspective — suite home

This repository is the front page of cruise105.github.io and the home of the **suite core**, the shared piece every app on the site loads.

## Apps on this site

- [Bestiary](https://cruise105.github.io/Bestiary/)
- [Character Sheet](https://cruise105.github.io/Character-Sheet/)
- [Session Notes](https://cruise105.github.io/Session-Notes/)
- [Magic Items](https://cruise105.github.io/Magic-Items/)

## Suite core (`core/suite.js`)

Phase 1 — shared Google sign-in. Sign in once in any app and the others use that sign-in instead of asking again. It's only handed to an app that needs no more permissions than it carries, and never to an app that last synced with a different Google account. Every app falls back to its own sign-in if the core can't load.

Planned next: a shared party file with permanent IDs, shared table settings and in-game date, then a launcher page here.
