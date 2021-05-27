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
            const expectedCollectors = [2, Math.round(spawns.length + sources.length)];
            const { controller } = room;
            if (controller?.my) {
                const progressRemaining = controller.progressTotal - controller.progress;
                if (progressRemaining < 100)
                    expectedCollectors.push(2);
                else if (progressRemaining < 1000)
                    expectedCollectors.push(10);
                else
                    expectedCollectors.push(20);
            }
            const collectors = _(creeps).filter(c => isSpecializedCreepOf(c, CollectorCreep)).size();
            room.visual.text(`Expected collectors: ${collectors}.`, 0, 0);
            if (collectors < Math.max(...expectedCollectors)) {
                // Spawn collectors if necessary.
                trySpawn(spawns, s => CollectorCreep.spawn(s));
            }
        }
    }
}
