import { createSchema30CoreTablesSql } from './schema30-reference-core-sql'
import { createSchema30GraphTablesSql } from './schema30-reference-graph-sql'

export function createSchema30TablesSql(): string {
  return `${createSchema30CoreTablesSql()}\n${createSchema30GraphTablesSql()}`
}
