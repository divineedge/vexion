const fs = require("node:fs");
const path = require("node:path");

function isInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Read only non-hidden regular files inside the build, including after symlink resolution. */
function readPublicFile(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    throw Object.assign(new Error("Malformed file path"), { status: 400 });
  }
  if (
    decoded.length > 4096 ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    decoded.split("/").some((part) => part.startsWith("."))
  ) {
    throw Object.assign(new Error("Forbidden file path"), { status: 403 });
  }
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, decoded.replace(/^\/+/, ""));
  if (!isInside(resolvedRoot, candidate)) {
    throw Object.assign(new Error("Forbidden file path"), { status: 403 });
  }
  const realFile = fs.realpathSync(candidate);
  if (!isInside(resolvedRoot, realFile)) {
    throw Object.assign(new Error("Forbidden file path"), { status: 403 });
  }
  if (!fs.statSync(realFile).isFile()) {
    throw Object.assign(new Error("Not found"), { status: 404 });
  }
  return fs.readFileSync(realFile);
}

module.exports = { readPublicFile };
