export class GithubApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string);
}

export type GithubRequestOptions = {
  repository: string;
  developmentBranch: string;
  token: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
};

export function normalizeGithubRepository(value: string): string;
export function normalizeGithubBranch(value: string): string;
export function verifyGithubIntegration(options: GithubRequestOptions): Promise<{
  repository: string;
  developmentBranch: string;
  sha: string;
}>;
export function createGithubBranch(options: GithubRequestOptions & { branch: string }): Promise<{
  repository: string;
  developmentBranch: string;
  branch: string;
  sha: string;
  alreadyExisted: boolean;
}>;
export function mergeGithubBranch(options: GithubRequestOptions & {
  branch: string;
  commitMessage?: string;
}): Promise<{
  repository: string;
  developmentBranch: string;
  branch: string;
  sha: string;
  alreadyUpToDate: boolean;
}>;
