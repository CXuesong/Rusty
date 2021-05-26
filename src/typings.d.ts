export { }

declare global {
    interface Memory {
        rusty: unknown;
    }

    interface CreepMemory {
        rusty: unknown;
        rustyType: string;
    }
}

declare module "lodash/index" {
    interface Collection<T> {
        abcdef: number;
        [Symbol.iterator](): IterableIterator<T>;
    }
}
