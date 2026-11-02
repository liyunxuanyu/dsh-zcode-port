/** Opaque brand helper local to ZCD; dsh brands are not re-exported. */
declare const zcdBrand: unique symbol

/** A string value carrying one opaque ZCD identity. */
export type ZcdBrand<T extends string> = string & { readonly [zcdBrand]: T }

/** One durable workflow run id. */
export type RunId = ZcdBrand<'WorkflowRunId'>

/** One workflow node id (hash of script, path, and arguments). */
export type NodeId = ZcdBrand<'WorkflowNodeId'>

/** One workflow hole id. */
export type HoleId = ZcdBrand<'WorkflowHoleId'>

/** Admit a raw string as a {@link RunId}. */
export function runId(value: string): RunId {
  return value as RunId
}

/** Admit a raw string as a {@link NodeId}. */
export function nodeId(value: string): NodeId {
  return value as NodeId
}

/** Admit a raw string as a {@link HoleId}. */
export function holeId(value: string): HoleId {
  return value as HoleId
}
