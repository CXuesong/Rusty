import _ from "lodash";
import { getRustyMemory } from "src/memory";
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
    for (const [k, m] of _(spawningCreeps).entries()) {
        const spawn = Game.getObjectById(k as Id<StructureSpawn>);
        if (!spawn) {
            console.log(`specializedCreeps.onNextFrame: discarded SpawningCreepEntry ${m.creep} as spawn is missing.`);
            delete spawningCreeps[k];
            continue;
        }
        // Still spawning
        if (spawn.spawning?.name === m.creep) continue;
        const creep = Game.getObjectById(m.creep as Id<Creep>);
        if (!creep) {
            // Creep is somehow gone. Discard stashed memory.
            console.log(`specializedCreeps.onNextFrame: discarded SpawningCreepEntry ${m.creep} as creep is missing.`);
            delete spawningCreeps[k];
            continue;
        }
        // Pop memory
        creep.memory = {
            ...creep.memory,
            ...m.memory
        };
        console.log(`Creep memory ${creep} ${JSON.stringify(creep.memory)}`);
        delete spawningCreeps[k];
    }

    // Drive the creeps
    for (const creep of _(Game.creeps).values()) {
        const sc = getSpecializedCreep(creep);
        if (!sc) continue;
        sc.nextFrame();
    }
}
