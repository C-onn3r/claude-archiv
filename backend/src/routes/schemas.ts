import { Type } from 'typebox';

export const ErrorResponse = Type.Object(
  { error: Type.Object({ code: Type.String(), message: Type.String() }) },
  { $id: 'ApiError', description: 'Einheitliches Fehlerformat' },
);

export const UserSchema = Type.Object({
  id: Type.String(),
  username: Type.String(),
  displayName: Type.String(),
  role: Type.Union([Type.Literal('admin'), Type.Literal('user')]),
  createdAt: Type.String(),
});

export const TokenPairSchema = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  tokenType: Type.Literal('Bearer'),
  /** Lebensdauer des Access-Tokens in Sekunden. */
  expiresIn: Type.Integer(),
  user: UserSchema,
});

export const ArchiveSchema = Type.Object({
  id: Type.String(),
  url: Type.String(),
  finalUrl: Type.Union([Type.String(), Type.Null()]),
  title: Type.String(),
  description: Type.String(),
  status: Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('done'), Type.Literal('failed')]),
  error: Type.Union([Type.String(), Type.Null()]),
  tags: Type.Array(Type.String()),
  options: Type.Object({ includeScripts: Type.Boolean() }),
  assetCount: Type.Integer(),
  failedCount: Type.Integer(),
  totalBytes: Type.Integer(),
  createdAt: Type.String(),
  startedAt: Type.Union([Type.String(), Type.Null()]),
  finishedAt: Type.Union([Type.String(), Type.Null()]),
});

export const username = Type.String({ pattern: '^[a-zA-Z0-9._-]{3,32}$', description: '3–32 Zeichen: Buchstaben, Ziffern, . _ -' });
export const password = Type.String({ minLength: 8, maxLength: 128 });

export const errorResponses = {
  400: { $ref: 'ApiError#' },
  401: { $ref: 'ApiError#' },
  403: { $ref: 'ApiError#' },
  404: { $ref: 'ApiError#' },
  409: { $ref: 'ApiError#' },
} as const;
