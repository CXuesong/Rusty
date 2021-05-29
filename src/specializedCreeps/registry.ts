import type { SpecializedCreepBase, SpecializedCreepType } from "./base";

const creepCache = new WeakMap<Creep, SpecializedCreepBase>();

export const knownCreepTypes: SpecializedCreepType[] = [];

function getNewSpecializedCreepInst(creep: Creep): SpecializedCreepBase | undefined {
    const { rustyType } = creep.memory;
    if (!rustyType) return undefined;
    const creepType = knownCreepTypes.find(t => t.rustyType === rustyType);
    if (!creepType) return undefined;
    return new creepType(creep);
}

export function getSpecializedCreep(creep: Creep): SpecializedCreepBase | undefined {
    let c = creepCache.get(creep);
    if (!c) {
        c = getNewSpecializedCreepInst(creep);
        if (c) creepCache.set(creep, c);
    }
    return c;
}
