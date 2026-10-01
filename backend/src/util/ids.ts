import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256Hex = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex');
