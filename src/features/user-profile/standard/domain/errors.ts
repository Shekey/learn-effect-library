// Plain Error subclasses. Nothing in a function signature tells you these can be thrown.
export class NotFoundError extends Error {}
export class UpstreamError extends Error {}
export class TimeoutError extends Error {}
export class InvalidResponseError extends Error {}
export class UserBannedError extends Error {}
