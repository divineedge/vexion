import { defineConfig } from "orval";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import config from "../orval.config";

// Exercise the full real specification without changing checked-in API clients.
const output = mkdtempSync(path.join(tmpdir(), "divine-edge-codegen-smoke-"));
const specification = path.resolve(__dirname, "..", "openapi.yaml");
process.once("exit", () => rmSync(output, { recursive: true, force: true }));

export default defineConfig({
  client: {
    input: { ...config["api-client-react"].input, target: specification },
    output: { target: path.join(output, "client.ts"), client: "fetch" },
  },
  schema: {
    input: { ...config.zod.input, target: specification },
    output: { target: path.join(output, "schema.ts"), client: "zod" },
  },
});
