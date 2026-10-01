/** Fehler mit HTTP-Status, der von der zentralen Fehlerbehandlung in eine einheitliche JSON-Antwort übersetzt wird. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message: string, code = 'bad_request') {
    return new HttpError(400, code, message);
  }
  static unauthorized(message = 'Authentifizierung erforderlich.', code = 'unauthorized') {
    return new HttpError(401, code, message);
  }
  static forbidden(message = 'Zugriff verweigert.', code = 'forbidden') {
    return new HttpError(403, code, message);
  }
  static notFound(message = 'Nicht gefunden.', code = 'not_found') {
    return new HttpError(404, code, message);
  }
  static conflict(message: string, code = 'conflict') {
    return new HttpError(409, code, message);
  }
  static badGateway(message: string, code = 'upstream_error') {
    return new HttpError(502, code, message);
  }
}
