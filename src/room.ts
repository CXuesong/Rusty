import _ from "lodash";
import { getRustyMemory } from "./memory";
import { trySpawn } from "./spawn";
import { isSpecializedCreepOf } from "./specializedCreeps";
import { CollectorCreep } from "./specializedCreeps/collector";

export function onNextFrame(): void {
    const { clock } = getRustyMemory();
    if (clock % 5 === 0) {
        for (const room of _(Game.rooms).values()) {
            const spawns = room.find(FIND_MY_SPAWNS);
            const sources = room.find(FIND_SOURCES_ACTIVE);
            const creeps = room.find(FIND_MY_CREEPS);
            const expectedCollectors = Math.max(1, Math.round(spawns.length + sources.length * 0.3));
            const collectors = _(creeps).filter(c => isSpecializedCreepOf(c, CollectorCreep)).size();
            if (collectors < expectedCollectors) {
                // Spawn collectors if necessary.
                trySpawn(spawns, s => CollectorCreep.spawn(s));
            }
        }
    }
}
