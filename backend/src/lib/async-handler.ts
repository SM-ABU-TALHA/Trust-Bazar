import type { RequestHandler } from 'express';

/** Wraps async handlers so rejections reach errorHandler (Express 4). */
export function ah(
  handler: (
    req: Parameters<RequestHandler>[0],
    res: Parameters<RequestHandler>[1],
    next: Parameters<RequestHandler>[2],
  ) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
