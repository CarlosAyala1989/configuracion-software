export class GithubApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string);
}

export type GithubRequestOptions = {
  token: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
};

export function normalizeGithubRepository(value: string): string;
export function normalizeGithubRepositoryName(value: string): string;
export function normalizeGithubBranch(value: string): string;
export function getGithubAuthenticatedUser(options: GithubRequestOptions): Promise<{
  login: string;
  name: string;
  avatarUrl: string | null;
}>;
export function createGithubRepository(options: GithubRequestOptions & {
  name: string;
  description?: string | null;
}): Promise<{
  owner: { login: string; name: string; avatarUrl: string | null };
  repository: string;
  name: string;
  developmentBranch: string;
  htmlUrl: string;
}>;
export function listGithubBranches(options: GithubRequestOptions & { repository: string }): Promise<Array<{
  name: string;
  sha: string;
  protected: boolean;
}>>;
export function verifyGithubBranch(options: GithubRequestOptions & {
  repository: string;
  branch: string;
}): Promise<{ repository: string; branch: string; sha: string }>;
export function verifyGithubIntegration(options: GithubRequestOptions & {
  repository: string;
  developmentBranch: string;
}): Promise<{
  repository: string;
  developmentBranch: string;
  sha: string;
}>;
export function createGithubBranch(options: GithubRequestOptions & {
  repository: string;
  developmentBranch: string;
  branch: string;
}): Promise<{
  repository: string;
  developmentBranch: string;
  branch: string;
  sha: string;
  alreadyExisted: boolean;
}>;
export function mergeGithubBranch(options: GithubRequestOptions & {
  repository: string;
  developmentBranch: string;
  branch: string;
  commitMessage?: string;
}): Promise<{
  repository: string;
  developmentBranch: string;
  branch: string;
  sha: string;
  alreadyUpToDate: boolean;
}>;
