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