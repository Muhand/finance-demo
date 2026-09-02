import { serve } from "@hono/node-server";

import { info } from "./log.ts";
import { initSec } from "./sec.ts";
import { app } from "./server.ts";

const port = Number(process.env.PORT ?? 4000);

initSec();

serve({ fetch: app.fetch, port }, (address) => {
  info(`listening on http://localhost:${address.port}`);
});
