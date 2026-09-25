# Design: several screens

Status: built in v36 (`docs/LANGUAGE.md` §4i). One change from this design: element names are
unique in the whole app for now, not per screen, so handlers and `data-el` need no qualified names.
Before v36 an app had one `screen`. Real apps have several: a list and a detail page,
a catalogue and a publisher page (the registry's hub), settings. Faking it with sections that are
shown or hidden loses what users expect from pages: an address to share, the back button, a
page that loads what it shows.

## What the language says

A screen has a name and a path, like an endpoint; a path param is declared like an endpoint's:

```
screen tickets "/" {
  list rows of Ticket {
    text subject
    button open "Open"
  }
}

screen ticket "/tickets/{id}" {
  path id: Int
  text subject = the @subject of the ticket whose @id is @id
  button back "Back"
}

on click open {
  - go to @ticket with @id = the @id of that ticket
}

on click back {
  - go back
}

on open ticket {
  - call @tickets.getTicket with @id = @id
}
```

- `screen <name> "<path>" { … }`. An app with one screen may keep writing `screen { … }`: that is
  `screen main "/"`.
- `path x: T` in a screen: the value from the path, available as `@x` while that screen is shown.
  The harness parses and checks it; a path that does not fit (`/tickets/abc`) is not that screen.
- Steps: `go to @screen with @x = …` (a new entry in the history) and `go back`.
- `on open <screen>` runs every time the screen is shown: from a link, a deep link, or `go back`.
  It is where a screen loads what it shows. `on start` still runs once, before the first screen.
- State stays the app's: every screen reads and changes the same state, so going back shows what
  was there. What belongs to one screen only is still ordinary state (a draft), reset where a
  sentence says so.
- Element names are unique per screen. A handler names an element by its name when that is
  unique in the app, and as `<screen>.<name>` when it is not (`on click ticket.back`). `data-el`
  is always qualified when names repeat, so the UI still leads back to one spec line.

## What the harness owns

- Routing: the current screen and its params are harness state, not app state. In the browser
  they are the address (`/tickets/3`, with history and the back button); a server serves every
  path the app declares.
- Defaults (§9): an address that matches no screen shows the first screen; `go back` on the first
  entry does nothing.
- The generated interface gets a `Route` type (one variant per screen, with its params) and
  `view` renders the current route's screen; `update` returns the route to go to.

## Tests

- Example steps: `open "/tickets/3"` (arrive by address), `go back` (the browser's back),
  `see screen = ticket` and `see path = "/tickets/3"`.
- Observations include the current screen and path, so two builds that navigate differently are
  different apps.
- Random sessions press the back button now and then, and open the addresses the examples use
  (with other path values: `/tickets/1`, `/tickets/99`).

## Traceability

The source map gets one entry per screen (its line), and elements carry their screen. Pointing
at an element in the running app leads to `screen ticket`, element `back`, line N.

## What stays out

- Nested layouts and tabs that keep their own history: compose screens with components.
- Guards ("only signed-in users"): a screen's `on open` can `go to @signIn`; a declared guard
  can come later if many apps write the same thing.

## Measured before it becomes part of the language

A two-screen version of the tickets screen and the registry's hub, built twice per target: first
try, twin-verified, and every existing app unchanged (the harness snapshot).
