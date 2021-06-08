export { }

declare global {
    interface Memory {
        rusty: unknown;
    }

    interface CreepMemory {
        rusty: unknown;
        rustyType: string;
    }

    interface RoomMemory {
        rusty: unknown;
        rustyCollector: unknown;
        rustyLink: unknown;
    }
}

declare module "lodash/index" {
    interface Collection<T> {
        [Symbol.iterator](): IterableIterator<T>;
    }
}
