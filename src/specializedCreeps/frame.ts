import { getRustyMemory } from "src/memory";
import wu from "wu";
import { SpecializedCreepBase } from "./base";
import { CollectorCreep } from "./collector";

export function getSpecializedCreep(creep: Creep): SpecializedCreepBase | undefined {
    switch (creep.memory.rustyType) {
        case CollectorCreep.rustyType:
            return new CollectorCreep(creep);
        default:
            // Unknown creep
            return undefined;
    }
}

export function onNextFrame() {
    const { spawningCreeps } = getRustyMemory();
    // Pop spawned creeps' memory
    for (const [k, m] of wu.entries(spawningCreeps)) {
        const spawn = Game.getObjectById(k as Id<StructureSpawn>);
        if (!spawn) {
            delete spawningCreeps[k];
            continue;
        }
        // Still spawning
        if (spawn.spawning?.name === m.creep) continue;
        const creep = Game.getObjectById(m.creep as Id<Creep>);
        if (!creep) {
            // Creep is somehow gone. Discard stashed memory.
            delete spawningCreeps[k];
            continue;
        }
        // Pop memory
        creep.memory = {
            ...creep.memory,
            ...m.memory
        };
        delete spawningCreeps[k];
    }

    // Drive the creeps
    for (const creep of wu.values(Game.creeps)) {
        const sc = getSpecializedCreep(creep);
        if (!sc) continue;
        sc.nextFrame();
    }
}
