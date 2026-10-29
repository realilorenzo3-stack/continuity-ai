import { z } from "zod";
import { writeFileSync } from "node:fs";
import { handoffSchema } from "../src/handoff/schema.js";
writeFileSync(
  "schemas/rhp-v0.1.json",
  JSON.stringify(z.toJSONSchema(handoffSchema), null, 2) + "\n",
);
