# Design: layers, the reusable parts of an HTTP service

Status: done (v21). The reference is §4h of docs/LANGUAGE.md; the layers are in lib/std/http/, the first app using them is apps/api/desk-api.intent.

CORS, API keys and security headers are things an author of an API wants, but does not want to
think through again. They are the same for every API, easy to get subtly wrong, and have
well-known behaviour that examples can pin down. That is what a spec bundle is for.

## A layer is a spec

```
layer std.http.cors
  "Lets web pages on other origins call the API, and only the origins you allow."

param origins: List Text = []     # the origins that may call; empty: any origin

before every request
  - if the method is OPTIONS and the request has an access-control-request-method header, it is a preflight: …
after every answer
  - if the request's origin is allowed, set header access-control-allow-origin to it …

example "a preflight from an allowed origin"
  request OPTIONS "/tickets" with header origin = "https://desk.example", header access-control-request-method = "POST"
  see status = 204
  see header access-control-allow-origin = "https://desk.example"
```

- `param name: Type [= default]`: what an app configures.
- `provides name: Type`: what the layer hands to the app's endpoints (`provides caller: Text`
  in an API-key layer; endpoint steps then say "the caller").
- `before every request`: may answer (and the app is not reached), or pass the request on.
- `after every answer`: may change the answer on the way out (typically: add headers). It runs
  for every answer: the app's, the harness's (404, 400) and the layers' own.
- Examples run the layer around a **stub app** that answers `200 { "reached": true, … }` with
  what the layer provided, so an example can see whether a request got through and as whom.
  `examples with` binds the params the examples use.

## An app uses layers

```
app DeskApi
profile api

use cors = std.http.cors
  origins = "https://desk.example"
use auth = std.http.apiKey
  keys = table
    key       | owner
    "k-ann"   | "Ann"
```

Layers run in the order of the `use` lines on the way in, and in reverse on the way out. The
app's examples go through them: `call listTickets with header x-api-key = "k-ann"`,
`see listTickets.header.vary = "origin"`, and raw requests: `request OPTIONS "/tickets" with …`
then `see request.status = 204`.

## Harness

- A layer is compiled like an app (twin, cache), once per layer spec. Its module is
  `before(request, config)` → `{ pass: provided }` or `{ answer: response }`, and
  `after(request, response, config)` → response. Requests and responses are plain data with
  lower-case header names.
- The app build copies each layer's verified module into `layers/<name>/` and generates the
  composition with the bound config. Nothing about a layer is compiled again for the app: reuse
  is a cache hit, and code that is not regenerated cannot diverge.
- Random sessions for the twin build draw methods, paths and header values from the examples.
