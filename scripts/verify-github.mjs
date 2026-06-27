import assert from "node:assert/strict";
import http from "node:http";

import {
  createGithubBranch,
  createGithubRepository,
  getGithubAuthenticatedUser,
  GithubApiError,
  listGithubBranches,
  mergeGithubBranch,
  normalizeGithubBranch,
  normalizeGithubRepository,
  normalizeGithubRepositoryName,
  verifyGithubBranch,
  verifyGithubIntegration
} from "../lib/github-api.mjs";
import { decryptGithubTokenValue, encryptGithubTokenValue } from "../lib/github-crypto.mjs";

const baseSha = "1111111111111111111111111111111111111111";
const featureSha = "2222222222222222222222222222222222222222";
const mergeSha = "3333333333333333333333333333333333333333";
const refs = new Map([["develop", baseSha]]);
const mergedHeads = new Set();
const checks = [];
let authorizationHeader = "";
let createdRepositoryBody = null;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (request, response) => {
  authorizationHeader = String(request.headers.authorization || "");
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const refPrefix = "/repos/acme/app/git/ref/heads/";

  if (request.method === "GET" && url.pathname === "/user") {
    return json(response, 200, {
      login: "octoadmin",
      name: "Octo Admin",
      avatar_url: "https://avatars.example/octoadmin"
    });
  }

  if (request.method === "POST" && url.pathname === "/user/repos") {
    createdRepositoryBody = await requestBody(request);
    return json(response, 201, {
      full_name: `octoadmin/${createdRepositoryBody.name}`,
      default_branch: "main",
      html_url: `https://github.com/octoadmin/${createdRepositoryBody.name}`
    });
  }

  if (request.method === "GET" && url.pathname === "/repos/acme/app/branches") {
    return json(response, 200, [...refs].map(([name, sha]) => ({
      name,
      commit: { sha },
      protected: name === "develop"
    })));
  }

  if (request.method === "GET" && url.pathname.startsWith(refPrefix)) {
    const branch = url.pathname.slice(refPrefix.length).split("/").map(decodeURIComponent).join("/");
    const sha = refs.get(branch);
    if (!sha) return json(response, 404, { message: "Reference not found" });
    return json(response, 200, { object: { sha } });
  }

  if (request.method === "POST" && url.pathname === "/repos/acme/app/git/refs") {
    const body = await requestBody(request);
    const branch = String(body.ref || "").replace(/^refs\/heads\//, "");
    if (refs.has(branch)) return json(response, 422, { message: "Reference already exists" });
    refs.set(branch, body.sha === baseSha ? featureSha : body.sha);
    return json(response, 201, { object: { sha: refs.get(branch) } });
  }

  if (request.method === "POST" && url.pathname === "/repos/acme/app/merges") {
    const body = await requestBody(request);
    if (body.head === "feature/conflict") {
      return json(response, 409, { message: "Merge conflict" });
    }
    if (mergedHeads.has(body.head)) {
      response.writeHead(204);
      return response.end();
    }
    refs.set(body.base, mergeSha);
    mergedHeads.add(body.head);
    return json(response, 201, { sha: mergeSha });
  }

  return json(response, 404, { message: "Not found" });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("No se inicio el servidor simulado");
const common = {
  repository: "acme/app",
  developmentBranch: "develop",
  token: "github_pat_test",
  apiBaseUrl: `http://127.0.0.1:${address.port}`
};

try {
  const encryptedToken = encryptGithubTokenValue(
    "github_pat_test",
    "12345678901234567890123456789012"
  );
  assert.equal(encryptedToken.includes("github_pat_test"), false);
  assert.equal(
    decryptGithubTokenValue(encryptedToken, "12345678901234567890123456789012"),
    "github_pat_test"
  );
  assert.throws(() =>
    decryptGithubTokenValue(encryptedToken, "abcdefghijklmnopqrstuvwxyz123456")
  );
  checks.push("token_cifrado_y_clave_incorrecta_bloqueada");

  assert.equal(normalizeGithubRepository("https://github.com/acme/app.git"), "acme/app");
  assert.equal(normalizeGithubRepositoryName("gestion-configuracion"), "gestion-configuracion");
  assert.equal(normalizeGithubBranch("feature/carrito"), "feature/carrito");
  assert.throws(() => normalizeGithubBranch("feature rama"), GithubApiError);
  checks.push("validacion_repositorio_y_rama");

  const owner = await getGithubAuthenticatedUser(common);
  assert.equal(owner.login, "octoadmin");
  const repository = await createGithubRepository({
    ...common,
    name: "gestion-configuracion",
    description: "Proyecto SGCS"
  });
  assert.equal(repository.repository, "octoadmin/gestion-configuracion");
  assert.equal(repository.developmentBranch, "main");
  assert.equal(createdRepositoryBody.private, true);
  assert.equal(createdRepositoryBody.auto_init, true);
  checks.push("propietario_consultado_y_repositorio_creado");

  const verified = await verifyGithubIntegration(common);
  assert.equal(verified.sha, baseSha);
  assert.equal(authorizationHeader, "Bearer github_pat_test");
  checks.push("credencial_y_rama_desarrollo_verificadas");

  const created = await createGithubBranch({ ...common, branch: "feature/carrito" });
  assert.equal(created.sha, featureSha);
  assert.equal(created.alreadyExisted, false);
  const retried = await createGithubBranch({ ...common, branch: "feature/carrito" });
  assert.equal(retried.sha, featureSha);
  assert.equal(retried.alreadyExisted, true);
  checks.push("rama_dev_creada_e_idempotente");

  const branches = await listGithubBranches(common);
  assert.equal(branches.some((branch) => branch.name === "feature/carrito"), true);
  const selected = await verifyGithubBranch({ ...common, branch: "feature/carrito" });
  assert.equal(selected.sha, featureSha);
  checks.push("ramas_listadas_y_rama_existente_verificada");

  const merged = await mergeGithubBranch({ ...common, branch: "feature/carrito" });
  assert.equal(merged.sha, mergeSha);
  assert.equal(merged.alreadyUpToDate, false);
  const noChanges = await mergeGithubBranch({ ...common, branch: "feature/carrito" });
  assert.equal(noChanges.sha, mergeSha);
  assert.equal(noChanges.alreadyUpToDate, true);
  checks.push("merge_qa_y_reintento_sin_cambios");

  refs.set("feature/conflict", featureSha);
  await assert.rejects(
    mergeGithubBranch({ ...common, branch: "feature/conflict" }),
    (error) => error instanceof GithubApiError && error.code === "merge-conflict"
  );
  checks.push("conflicto_de_merge_bloqueado");

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
