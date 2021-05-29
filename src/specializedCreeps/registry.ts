import type { SpecializedCreepBase, SpecializedCreepType } from "./base";

const creepCache = new Map<Id<Creep>, SpecializedCreepBase>();

export const knownCreepTypes: SpecializedCreepType[] = [];

function getNewSpecializedCreepInst(creep: Creep | Id<Creep>): SpecializedCreepBase | undefined {
    if (!(creep instanceof Creep)) {
        const c = Game.getObjectById(creep);
        if (!(c instanceof Creep)) throw new Error(`Invalid Creep object: ${c} specified via ID ${creep}.`);
        creep = c;
    }
    const { rustyType } = creep.memory;
    if (!rustyType) return undefined;
    const creepType = knownCreepTypes.find(t => t.rustyType === rustyType);
    if (!creepType) return undefined;
    return new creepType(creep.id);
}

export function getSpecializedCreep(creep: Creep | Id<Creep>): SpecializedCreepBase | undefined {
    const id = creep instanceof Creep ? creep.id : creep;
    // Spawnning screep does not own ID.
    if (!id) return undefined;
    let c = creepCache.get(id);
    if (!c) {
        c = getNewSpecializedCreepInst(creep);
        if (c) creepCache.set(id, c);
    }
    return c;
}

export function houseKeeping() {
    for (const [k, v] of creepCache.entries()) {
        if (!(Game.getObjectById(k) instanceof Creep)) {
            v.dispose();
            creepCache.delete(k);
        }
    }
}

export function __internal__getSpecializedCreepsCache(): unknown {
    return creepCache;
}
