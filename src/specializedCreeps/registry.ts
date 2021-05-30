import { Logger } from "src/utility/logger";
import type { SpecializedCreepBase, SpecializedCreepType } from "./base";

const creepCache = new Map<Id<Creep>, SpecializedCreepBase>();

export const knownCreepTypes: SpecializedCreepType[] = [];

const logger = new Logger("Rusty.SpecializedCreeps.Registry");

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

export function getSpecializedCreep<T extends SpecializedCreepType>(creep: Creep | Id<Creep>, expectedType?: T): InstanceType<T> | undefined {
    const id = creep instanceof Creep ? creep.id : creep;
    // Spawnning screep does not own ID.
    if (!id) return undefined;
    let c = creepCache.get(id);
    if (c) {
        // Re-validate creeps
        if (!Game.getObjectById(id)) {
            // Cache invalidated
            logger.warning(`Invalidating creep: ${creep} (${id}).`);
            creepCache.delete(id);
            c.dispose();
            c = undefined;
        }
    } else {
        c = getNewSpecializedCreepInst(creep);
        if (c) creepCache.set(id, c);
    }
    if (c && expectedType && !(c instanceof expectedType))
        throw new TypeError(`Expect creep ${creep} to be of ${expectedType.rustyType}. Actual: ${c}.`);
    return c as InstanceType<T>;
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
