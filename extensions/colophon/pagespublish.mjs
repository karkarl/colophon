import { spawn } from "node:child_process";

class GhError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.status = status;
  }
}

function isNotFound(error) {
  return error?.status === 404;
}

function slugify(value) {
  const slug = String(value || "prototype")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return slug || "prototype";
}

export async function runGh(args, { input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new GhError(`Unable to run GitHub CLI: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      const status = Number((stderr.match(/\bHTTP (\d{3})\b/) || stderr.match(/\b(\d{3})\b/))?.[1]) || null;
      reject(new GhError(stderr.trim() || `GitHub CLI exited with code ${code}`, { status }));
    });
    child.stdin.end(input || "");
  });
}

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub returned invalid JSON while ${context}`);
  }
}

async function api(run, method, endpoint, body) {
  const args = ["api", "--method", method, endpoint];
  if (body !== undefined) args.push("--input", "-");
  return parseJson(await run(args, body === undefined ? undefined : { input: JSON.stringify(body) }), endpoint);
}

async function readOptional(run, endpoint) {
  try {
    return await api(run, "GET", endpoint);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function currentBranch(run, repo, branch) {
  const ref = await readOptional(run, `repos/${repo}/git/ref/heads/${branch}`);
  if (!ref) return null;
  const commit = await api(run, "GET", `repos/${repo}/git/commits/${ref.object.sha}`);
  return { head: ref.object.sha, tree: commit.tree.sha };
}

async function writeCommit(run, repo, branch, filePath, content) {
  const blob = await api(run, "POST", `repos/${repo}/git/blobs`, {
    content: Buffer.from(content, "utf8").toString("base64"),
    encoding: "base64",
  });
  const current = await currentBranch(run, repo, branch);
  const tree = await api(run, "POST", `repos/${repo}/git/trees`, {
    ...(current ? { base_tree: current.tree } : {}),
    tree: [{ path: filePath, mode: "100644", type: "blob", sha: blob.sha }],
  });
  const commit = await api(run, "POST", `repos/${repo}/git/commits`, {
    message: "Publish Colophon prototype",
    tree: tree.sha,
    ...(current ? { parents: [current.head] } : {}),
  });
  if (current) {
    try {
      await api(run, "PATCH", `repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
    } catch (error) {
      if (!(error instanceof GhError) || error.status !== 422) throw error;
      return writeCommit(run, repo, branch, filePath, content);
    }
  } else {
    await api(run, "POST", `repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  }
  return commit.sha;
}

export async function publishPrototypeToPages({ html, name, workingDirectory, run = runGh }) {
  const execute = (args, options) => run(args, { ...options, cwd: workingDirectory });
  const repoInfo = parseJson(await execute(["repo", "view", "--json", "nameWithOwner,viewerPermission,isArchived"]), "reading repository information");
  if (!repoInfo.nameWithOwner) throw new Error("The current directory is not a GitHub repository.");
  if (repoInfo.isArchived) throw new Error("Cannot publish to an archived repository.");
  if (repoInfo.viewerPermission !== "ADMIN") throw new Error("GitHub Pages publishing requires repository admin permission.");

  let pages = await readOptional(execute, `repos/${repoInfo.nameWithOwner}/pages`);
  if (pages && (pages.build_type !== "legacy" || pages.source?.branch !== "gh-pages")) {
    throw new Error("Existing GitHub Pages is not configured for the gh-pages branch. Reconfigure it outside Colophon before publishing.");
  }
  const sourcePath = pages?.source?.path === "/docs" ? "docs" : "";
  const slug = slugify(name);
  const filePath = [sourcePath, "colophon", slug, "index.html"].filter(Boolean).join("/");
  const commit = await writeCommit(execute, repoInfo.nameWithOwner, "gh-pages", filePath, html);

  if (!pages) {
    pages = await api(execute, "POST", `repos/${repoInfo.nameWithOwner}/pages`, {
      build_type: "legacy",
      source: { branch: "gh-pages", path: "/" },
    });
  }
  const baseUrl = pages.html_url;
  if (!baseUrl) throw new Error("GitHub Pages was configured but did not return a site URL.");
  return {
    repo: repoInfo.nameWithOwner,
    branch: "gh-pages",
    path: filePath,
    commit,
    url: new URL(`${sourcePath ? "docs/" : ""}colophon/${slug}/`, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href,
  };
}
