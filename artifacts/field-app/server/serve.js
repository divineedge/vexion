/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { readPublicFile } = require("./public-files.cjs");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res, staticRoot) {
  if (platform !== "ios" && platform !== "android") {
    res.writeHead(400);
    res.end("Invalid platform");
    return;
  }
  const manifest = readPublicFile(staticRoot, `/${platform}/manifest.json`);
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto === "http" ? "http" : "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"] || "";
  if (typeof host !== "string" || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) {
    res.writeHead(400);
    res.end("Invalid host");
    return;
  }
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, () => escapeHtml(baseUrl))
    .replace(/EXPS_URL_PLACEHOLDER/g, () => escapeHtml(expsUrl))
    .replace(/APP_NAME_PLACEHOLDER/g, () => escapeHtml(appName));

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveStaticFile(urlPath, res, staticRoot) {
  const content = readPublicFile(staticRoot, urlPath);
  const ext = path.extname(urlPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": contentType });
  res.end(content);
}

function createStaticServer(options = {}) {
  const staticRoot = options.staticRoot || STATIC_ROOT;
  const landingPageTemplate =
    options.template ?? fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const appName = options.appName ?? getAppName();
  const mountPath = options.basePath ?? basePath;
  return http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end("Method not allowed");
      return;
    }
    try {
      const url = new URL(req.url || "/", "http://localhost");
      let pathname = url.pathname;

      if (
        mountPath &&
        (pathname === mountPath || pathname.startsWith(`${mountPath}/`))
      ) {
        pathname = pathname.slice(mountPath.length) || "/";
      }

      if (pathname === "/" || pathname === "/manifest") {
        const platform = req.headers["expo-platform"];
        if (platform === "ios" || platform === "android") {
          return serveManifest(platform, res, staticRoot);
        }

        if (pathname === "/") {
          return serveLandingPage(req, res, landingPageTemplate, appName);
        }
      }

      serveStaticFile(pathname, res, staticRoot);
    } catch (error) {
      const status =
        error.status ||
        (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code) ? 404 : 400);
      res.writeHead(status);
      res.end(status === 404 ? "Not found" : "Invalid request");
    }
  });
}

if (require.main === module) {
  const server = createStaticServer();
  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Serving static Expo build on port ${port}`);
  });
}

module.exports = { createStaticServer };
