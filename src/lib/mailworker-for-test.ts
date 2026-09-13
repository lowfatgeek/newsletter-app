// Re-export shim so tests can import both outbox and worker from one module.
export { enqueueTransactionalEmail } from "./outbox";
export { processOutbox } from "./mailworker";
