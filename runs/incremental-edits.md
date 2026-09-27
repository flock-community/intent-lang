# Incremental builds: recorded edits

The compiler is the one in this run; each row is an edit applied after the previous one.
Apps: apps/01-counter.intent, apps/02-todo.intent.

| app | edit | ok | verified | reused | A cost | total | ms |
|---|---|---|---|---|---|---|---|
| 01-counter | a new example (no code change) | yes | twin | app code | $0.000 | $0.000 | 91 |
| 01-counter | a changed handler | yes | twin | regions | $0.007 | $0.020 | 4557 |
| 01-counter | a changed element label | yes | twin | no | $0.006 | $0.013 | 2317 |
| 02-todo | a new example (no code change) | yes | twin | app code | $0.000 | $0.000 | 91 |
| 02-todo | a changed handler | yes | twin | regions | $0.007 | $0.029 | 10054 |
| 02-todo | a changed element label | yes | twin | no | $0.021 | $0.036 | 8729 |

6/6 edits kept a verified build.
