import { dump, load } from "js-yaml"

export function toYaml(value: unknown): string {
  return dump(value, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  })
}

export function fromYaml<T>(text: string): T {
  return load(text) as T
}
