export type Role = 'admin' | 'user';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export type ArchiveStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Archive {
  id: string;
  url: string;
  finalUrl: string | null;
  title: string;
  description: string;
  status: ArchiveStatus;
  error: string | null;
  tags: string[];
  options: { includeScripts: boolean };
  assetCount: number;
  failedCount: number;
  totalBytes: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Meta {
  name: string;
  apiVersion: string;
  registrationOpen: boolean;
  needsSetup: boolean;
  accessTokenTtlSec: number;
  contentTokenTtlSec: number;
}

export interface ProxyLink {
  targetUrl: string;
  proxyUrl: string;
  expiresAt: string;
}

export interface ArchiveView {
  viewUrl: string;
  expiresAt: string;
}
