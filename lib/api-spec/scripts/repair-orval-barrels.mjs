import { readFile, writeFile } from "node:fs/promises";

const barrels = [
  ["../../api-zod/src/index.ts", 'export * from "./generated/api";\n'],
  ["../../api-client-react/src/index.ts", [
    'export * from "./generated/api";',
    'export * from "./generated/api.schemas";',
    'export {',
    '  setBaseUrl,',
    '  setAuthTokenGetter,',
    '  setUnauthorizedHandler,',
    '  setDefaultHeaders,',
    '  customFetch,',
    '} from "./custom-fetch";',
    'export type { AuthTokenGetter, UnauthorizedHandler } from "./custom-fetch";',
    'export * from "./manual-hooks";',
    '',
  ].join("\n")],
];

await Promise.all(barrels.map(async ([file, contents]) => {
  await writeFile(new URL(file, import.meta.url), contents);
}));

// Avoid eager File references on Node runtimes without the File global.
const zodFile = new URL("../../api-zod/src/generated/api.ts", import.meta.url);
const zodSource = await readFile(zodFile, "utf8");
await writeFile(zodFile, zodSource.replace(/^import \{ File \} from "node:buffer";\n/gm, "")
  .replaceAll("zod.instanceof(File)", 'zod.custom<Blob>((value) => typeof Blob !== "undefined" && value instanceof Blob)'));
const uploadType = new URL("../../api-zod/src/generated/types/uploadChemicalDocumentBody.ts", import.meta.url);
await writeFile(uploadType, (await readFile(uploadType, "utf8")).replace(/^import type \{ Blob \} from "node:buffer";\n/gm, ""));