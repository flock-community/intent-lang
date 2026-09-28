// A job (`profile job`): the app without a page, for a host that runs it headless (a worker, an
// agent runtime). The host starts it and hands it events; `run` resolves once every call the event
// set off has been answered, with the app's data. Calls and events go through the host's transport
// when it sets one (`globalThis.__intentTransport`, calls.ts), else over HTTP.
import type { Program, Wire } from "./ui.ts";
import { inFlight } from "./calls.ts";

export interface Job {
  /** Hand the job an event (`{ event: "notes.noteCreated", body }`), or nothing to let it settle. */
  run(input?: { event?: { event: string; body: unknown } }): Promise<unknown>;
}

/** `read`: an event from the host in the spec's names (a choice's wire name read back), when there are wire names. */
export function headless<M>(p: Program<M> & { data: (m: M) => unknown; read?: (e: { event: string; body: unknown }) => { event: string; body: unknown } }): { dispatch: (w: Wire) => void; job: Job } {
  let model = p.init();
  const dispatch = (w: Wire) => {
    model = p.step(w, model);
  };
  if (p.clockMs) setInterval(() => dispatch({ on: "tick", target: "" }), p.clockMs);
  // Settled: no call in flight across a few turns (answers the harness gives later are queued too).
  const settled = async () => {
    for (let quiet = 0; quiet < 3; ) {
      await new Promise((r) => setTimeout(r, 0));
      quiet = inFlight() ? 0 : quiet + 1;
    }
  };
  return {
    dispatch,
    job: {
      async run(input) {
        const e = input?.event && (p.read ? p.read(input.event) : input.event);
        if (e) dispatch({ on: "event", target: e.event, event: e });
        await settled();
        return p.data(model);
      },
    },
  };
}
