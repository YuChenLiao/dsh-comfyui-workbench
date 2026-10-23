/** `/object_info` 里单个节点的描述（只声明会用到的字段）。 */
export interface ObjectInfoNode {
  input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> }
  output?: unknown[]
  output_node?: boolean
}

/** `/object_info` 的整表。 */
export type ObjectInfo = Record<string, ObjectInfoNode>

/** `/history/{id}` 里一条记录（只声明会用到的字段）。 */
export interface HistoryEntry {
  outputs?: Record<string, Record<string, unknown>>
  status?: {
    completed?: boolean
    status_str?: string
    messages?: unknown[]
  }
  prompt?: unknown
}

/** 产物文件引用（history.outputs 里的值）。 */
export interface FileRef {
  filename: string
  subfolder?: string
  type?: string
}
