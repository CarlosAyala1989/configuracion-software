import "server-only";

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
} from "@/lib/github-api";
import { query } from "@/lib/db";
import { decryptGithubTokenValue, encryptGithubTokenValue } from "@/lib/github-crypto";

export {
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
};

export type ProjectGithubIntegration = {
  ownerLogin: string;
  repository: string;
  developmentBranch: string;
  token: string;
};

function encryptionSecret() {
  const secret = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("Falta GITHUB_TOKEN_ENCRYPTION_KEY con al menos 32 caracteres.");
  }
  return secret;
}

export function encryptGithubToken(token: string) {
  return encryptGithubTokenValue(token, encryptionSecret());
}

export function decryptGithubToken(value: string) {
  return decryptGithubTokenValue(value, encryptionSecret());
}

export async function getProjectGithubIntegration(projectId: number): Promise<ProjectGithubIntegration | null> {
  const rows = await query<{
    github_repository: string | null;
    github_owner_login: string | null;
    github_development_branch: string | null;
    github_token_encrypted: string | null;
  }>(
    `SELECT github_owner_login, github_repository, github_development_branch, github_token_encrypted
     FROM projects
     WHERE id = ?
     LIMIT 1`,
    [projectId]
  );
  const row = rows[0];
  if (!row?.github_repository || !row.github_development_branch || !row.github_token_encrypted) return null;
  return {
    ownerLogin: row.github_owner_login || row.github_repository.split("/")[0],
    repository: row.github_repository,
    developmentBranch: row.github_development_branch,
    token: decryptGithubToken(row.github_token_encrypted)
  };
}

export function githubErrorParam(error: unknown) {
  if (error instanceof GithubApiError) return error.code;
  return "github-configuration";
}
