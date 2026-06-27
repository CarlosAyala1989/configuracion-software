const DEFAULT_API_BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";

export class GithubApiError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "GithubApiError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeGithubRepository(value) {
  const raw = String(value || "").trim().replace(/\.git$/i, "");
  let repository = raw;

  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new GithubApiError("invalid-repository", 0, "El repositorio GitHub no es valido.");
    }
    if (url.hostname.toLowerCase() !== "github.com") {
      throw new GithubApiError("invalid-repository", 0, "Solo se admiten repositorios de github.com.");
    }
    repository = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  }

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new GithubApiError("invalid-repository", 0, "Usa el formato propietario/repositorio.");
  }
  return repository;
}

export function normalizeGithubRepositoryName(value) {
  const name = String(value || "").trim().replace(/\.git$/i, "");
  if (
    !name ||
    name.length > 100 ||
    name === "." ||
    name === ".." ||
    !/^[A-Za-z0-9_.-]+$/.test(name)
  ) {
    throw new GithubApiError("invalid-repository", 0, "El nombre del repositorio no es valido.");
  }
  return name;
}

export function normalizeGithubBranch(value) {
  const branch = String(value || "").trim();
  const invalidComponent = branch.split("/").some(
    (component) => !component || component.startsWith(".") || component.endsWith(".lock")
  );
  if (
    !branch ||
    branch === "@" ||
    branch.length > 220 ||
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    invalidComponent
  ) {
    throw new GithubApiError("invalid-branch", 0, "El nombre de rama no es valido.");
  }
  return branch;
}

function refPath(branch) {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function githubErrorCode(status) {
  if (status === 401) return "invalid-token";
  if (status === 403) return "insufficient-permissions";
  if (status === 404) return "repository-or-branch-not-found";
  if (status === 409) return "merge-conflict";
  if (status === 422) return "github-validation";
  return "github-unavailable";
}

async function githubRequest({
  repository,
  token,
  path,
  method = "GET",
  body,
  fetchImpl = fetch,
  apiBaseUrl = DEFAULT_API_BASE_URL
}) {
  let response;
  try {
    const requestPath = repository ? `/repos/${repository}${path}` : path;
    response = await fetchImpl(`${apiBaseUrl}${requestPath}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "SGCS-DevOps",
        "X-GitHub-Api-Version": API_VERSION
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
  } catch {
    throw new GithubApiError("github-unavailable", 503, "No se pudo conectar con GitHub.");
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new GithubApiError(
      githubErrorCode(response.status),
      response.status,
      typeof payload?.message === "string" ? payload.message : "GitHub no pudo completar la operacion."
    );
  }
  return payload;
}

async function getBranchRef(options, branch) {
  const payload = await githubRequest({
    ...options,
    path: `/git/ref/heads/${refPath(branch)}`
  });
  const sha = payload?.object?.sha;
  if (typeof sha !== "string" || !sha) {
    throw new GithubApiError("invalid-github-response", 502, "GitHub no devolvio el commit de la rama.");
  }
  return sha;
}

export async function getGithubAuthenticatedUser(options) {
  const payload = await githubRequest({
    token: options.token,
    fetchImpl: options.fetchImpl,
    apiBaseUrl: options.apiBaseUrl,
    path: "/user"
  });
  if (typeof payload?.login !== "string" || !payload.login) {
    throw new GithubApiError("invalid-github-response", 502, "GitHub no devolvio el usuario autenticado.");
  }
  return {
    login: payload.login,
    name: typeof payload.name === "string" && payload.name ? payload.name : payload.login,
    avatarUrl: typeof payload.avatar_url === "string" ? payload.avatar_url : null
  };
}

export async function createGithubRepository(options) {
  const name = normalizeGithubRepositoryName(options.name);
  const owner = await getGithubAuthenticatedUser(options);
  const payload = await githubRequest({
    token: options.token,
    fetchImpl: options.fetchImpl,
    apiBaseUrl: options.apiBaseUrl,
    path: "/user/repos",
    method: "POST",
    body: {
      name,
      description: options.description,
      private: true,
      auto_init: true
    }
  });
  const repository = typeof payload?.full_name === "string" ? payload.full_name : `${owner.login}/${name}`;
  const developmentBranch = typeof payload?.default_branch === "string" && payload.default_branch
    ? payload.default_branch
    : "main";
  return {
    owner,
    repository: normalizeGithubRepository(repository),
    name,
    developmentBranch: normalizeGithubBranch(developmentBranch),
    htmlUrl: typeof payload?.html_url === "string" ? payload.html_url : `https://github.com/${repository}`
  };
}

export async function listGithubBranches(options) {
  const repository = normalizeGithubRepository(options.repository);
  const payload = await githubRequest({
    ...options,
    repository,
    path: "/branches?per_page=100"
  });
  if (!Array.isArray(payload)) {
    throw new GithubApiError("invalid-github-response", 502, "GitHub no devolvio la lista de ramas.");
  }
  return payload
    .filter((branch) => typeof branch?.name === "string" && branch.name)
    .map((branch) => ({
      name: branch.name,
      sha: typeof branch.commit?.sha === "string" ? branch.commit.sha : "",
      protected: Boolean(branch.protected)
    }));
}

export async function verifyGithubBranch(options) {
  const repository = normalizeGithubRepository(options.repository);
  const branch = normalizeGithubBranch(options.branch);
  const sha = await getBranchRef({ ...options, repository }, branch);
  return { repository, branch, sha };
}

export async function verifyGithubIntegration(options) {
  const repository = normalizeGithubRepository(options.repository);
  const developmentBranch = normalizeGithubBranch(options.developmentBranch);
  const sha = await getBranchRef({ ...options, repository }, developmentBranch);
  return { repository, developmentBranch, sha };
}

export async function createGithubBranch(options) {
  const repository = normalizeGithubRepository(options.repository);
  const developmentBranch = normalizeGithubBranch(options.developmentBranch);
  const branch = normalizeGithubBranch(options.branch);
  if (branch === developmentBranch) {
    throw new GithubApiError("same-branch", 0, "La rama DEV debe ser diferente de la rama de desarrollo.");
  }

  const baseSha = await getBranchRef({ ...options, repository }, developmentBranch);
  let payload;
  try {
    payload = await githubRequest({
      ...options,
      repository,
      path: "/git/refs",
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: baseSha }
    });
  } catch (error) {
    if (!(error instanceof GithubApiError) || error.status !== 422) throw error;
    const existingSha = await getBranchRef({ ...options, repository }, branch);
    return { repository, developmentBranch, branch, sha: existingSha, alreadyExisted: true };
  }
  const sha = payload?.object?.sha;
  if (typeof sha !== "string" || !sha) {
    throw new GithubApiError("invalid-github-response", 502, "GitHub no confirmo la rama creada.");
  }
  return { repository, developmentBranch, branch, sha, alreadyExisted: false };
}

export async function mergeGithubBranch(options) {
  const repository = normalizeGithubRepository(options.repository);
  const developmentBranch = normalizeGithubBranch(options.developmentBranch);
  const branch = normalizeGithubBranch(options.branch);
  if (branch === developmentBranch) {
    throw new GithubApiError("same-branch", 0, "La rama DEV debe ser diferente de la rama de desarrollo.");
  }

  const payload = await githubRequest({
    ...options,
    repository,
    path: "/merges",
    method: "POST",
    body: {
      base: developmentBranch,
      head: branch,
      commit_message: options.commitMessage
    }
  });
  const sha = typeof payload?.sha === "string"
    ? payload.sha
    : await getBranchRef({ ...options, repository }, developmentBranch);
  return { repository, developmentBranch, branch, sha, alreadyUpToDate: payload === null };
}
