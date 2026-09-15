// Re-export shim so tests can import both outbox and worker from one module.

export { processOutbox } from "./mailworker";
export { enqueueTransactionalEmail } from "./outbox";
