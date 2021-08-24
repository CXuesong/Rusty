export { }

declare global {
    interface Memory {
        rusty: unknown;
    }

    interface CreepMemory {
        rusty: unknown;
        rustyType: string;
        rustySku?: string;
    }

    interface RoomMemory {
        rusty: unknown;
        rustyCollector: unknown;
        rustyLink: unknown;
    }

    /** Rusty console utility. */
    var RustyUtils: unknown;
}

declare module "lodash/index" {
    interface Collection<T> {
        [Symbol.iterator](): IterableIterator<T>;
    }
}
