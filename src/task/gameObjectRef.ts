const gameObjectRefCache = new Map<Id<any>, GameObjectRef<any>>();
let purgeCounter = 0;

export class GameObjectRef<T> {
    private resolvedName: string | undefined;
    /** Internal construct */
    public constructor(public readonly id: Id<never>) {
    }
    public get target(): T | undefined {
        const o = Game.getObjectById(this.id) || undefined;
        if (this.resolvedName == null && o) this.resolvedName = String(o);
        return o;
    }
    public get exists(): boolean {
        return !!Game.getObjectById(this.id);
    }
    public toString(): string {
        return `${this.id} (${this.resolvedName ?? Game.getObjectById(this.id) ?? "<missing>"})`;
    }
}

export function gameObjectRefFromId<T>(id: Id<T> | { id: Id<T> }): GameObjectRef<T>;
export function gameObjectRefFromId<T>(id: Id<unknown> | { id: Id<unknown> }): GameObjectRef<T>;    // Generic type hack
// export function gameObjectRefFromId<T1, T2>(id: Id<T1> | Id<T2>): GameObjectRef<T1 | T2>;
// export function gameObjectRefFromId<T1, T2, T3>(id: Id<T1> | Id<T2> | Id<T3> | { id: Id<T1> | Id<T2> | Id<T3> }): GameObjectRef<T1 | T2 | T3>;
// export function gameObjectRefFromId<T1, T2, T3, T4>(id: Id<T1> | Id<T2> | Id<T3> | Id<T4>): GameObjectRef<T1 | T2 | T3 | T4>;
// export function gameObjectRefFromId<T1, T2, T3, T4, T5>(id: Id<T1> | Id<T2> | Id<T3> | Id<T4> | Id<T5>): GameObjectRef<T1 | T2 | T3 | T4 | T5>;
// export function gameObjectRefFromId<T1, T2, T3, T4, T5, T6>(id: Id<T1> | Id<T2> | Id<T3> | Id<T4> | Id<T5> | Id<T6>): GameObjectRef<T1 | T2 | T3 | T4 | T5 | T6>;
export function gameObjectRefFromId<T>(id: Id<T> | { id: Id<T> }): GameObjectRef<T> {
    if ("id" in id) id = id.id;
    let ref = gameObjectRefCache.get(id);
    if (!ref) {
        ref = new GameObjectRef<T>(id as any);
        if (Game.getObjectById(id)) {
            gameObjectRefCache.set(id, ref);
            purgeCounter++;
            if (purgeCounter >= 1000) {
                purgeCounter = 0;
                for (const id of gameObjectRefCache.keys()) {
                    if (!Game.getObjectById(id))
                        gameObjectRefCache.delete(id);
                }
            }
        }
    }
    return ref;
}