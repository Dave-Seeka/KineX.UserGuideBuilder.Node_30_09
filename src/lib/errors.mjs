export class FlowSkippedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlowSkippedError';
  }
}
