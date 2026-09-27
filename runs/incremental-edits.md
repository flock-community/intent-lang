# Incremental builds: recorded edits

The compiler is the one in this run; each row is an edit applied after the previous one.
Apps: apps/01-counter.intent, apps/02-todo.intent, apps/09-board.intent, apps/21-tags.intent.

| app | edit | ok | verified | reused | A cost | total | ms |
|---|---|---|---|---|---|---|---|
| 01-counter | a new example (no code change) | yes | twin | app code | $0.000 | $0.000 | 95 |
| 01-counter | a changed handler | yes | twin | regions | $0.007 | $0.021 | 3971 |
| 01-counter | a changed element label | yes | twin | no | $0.007 | $0.020 | 3618 |
| 02-todo | a new example (no code change) | yes | twin | app code | $0.000 | $0.000 | 96 |
| 02-todo | a changed handler | yes | twin | regions | $0.008 | $0.023 | 7546 |
| 02-todo | a changed element label | yes | twin | no | $0.007 | $0.023 | 8713 |
| 09-board | a changed derived value | yes | twin | no | $0.008 | $0.016 | 5501 |
| 09-board | a changed element label | yes | twin | no | $0.008 | $0.016 | 4104 |
| 21-tags | a new example (no code change) | yes | twin | app code | $0.000 | $0.000 | 94 |
| 21-tags | a changed handler | yes | twin | regions | $0.007 | $0.021 | 5116 |

10/10 edits kept a verified build.
