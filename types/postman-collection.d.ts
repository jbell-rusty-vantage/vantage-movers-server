declare module "postman-collection" {
  export class Collection {
    constructor(def?: unknown);
    items: { add(item: unknown): void };
    toJSON(): Record<string, unknown>;
  }
  export class Item {
    constructor(def?: unknown);
  }
  export class ItemGroup {
    constructor(def?: unknown);
    items: { add(item: unknown): void };
  }
}
