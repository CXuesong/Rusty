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
    }
}

declare module "lodash/index" {
    interface Collection<T> {
        [Symbol.iterator](): IterableIterator<T>;
    }
}
