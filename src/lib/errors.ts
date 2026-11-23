export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: Record<string, unknown>) {
    super(message);
  }
}
export const notFound = (what = "Record") => new ApiError(404, `${what} not found`);
export const forbidden = (msg = "You do not have permission to perform this action") => new ApiError(403, msg);
export const badRequest = (msg: string, data?: Record<string, unknown>) => new ApiError(400, msg, data);
export const conflict = (msg: string, data?: Record<string, unknown>) => new ApiError(409, msg, data);
