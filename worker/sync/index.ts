// Module A public surface — see docs/dev-contracts.md "Module A exports".
export { syncRoutes } from './webhook';
export { reconcileBoard, reconcileAll } from './reconcile';
export { deltaSync, deltaSyncIfStale, mirrorVerificadoAt } from './delta';
export { refetchItem, refetchItemTree, refetchItems } from './refetch';
export { confirmOutboxEcho, confirmOutboxEchoMany } from './echo';
export { upsertItem, upsertItemsBulk, mirrorUpsertStatement, emitItemSideEffects } from './upsert';
