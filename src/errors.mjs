export class PublishError extends Error {
  constructor(stage, code, details = {}) {
    super(`${stage}: ${code}`);
    this.stage = stage;
    this.code = code;
    this.details = details;
  }
}
