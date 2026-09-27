# Incremental builds: recorded edits

The compiler is the one in this run; each row is an edit of apps/01-counter.intent applied after the previous one.

| app | edit | ok | verified | reused | A cost | total | ms |
|---|---|---|---|---|---|---|---|
| 01-counter | a new example (no code change) | yes | twin | app code | $0.000 | $0.000 | 91 |
| 01-counter | a changed handler | yes | twin | regions | $0.007 | $0.020 | 4500 |
| 01-counter | a changed element label | yes | twin | no | $0.006 | $0.013 | 2719 |

3/3 edits kept a verified build.
