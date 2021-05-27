import _ from "lodash";
import { trySpawn } from "./spawn";
import { isSpecializedCreepOf } from "./specializedCreeps";
import { CollectorCreep } from "./specializedCreeps/collector";

interface RustyRoomMemory {
    nextSpawnTime?: number;
}

export function onNextFrame(): void {
    for (const room of _(Game.rooms).values()) {
        if (typeof room.memory.rusty !== "object") room.memory.rusty = {};
        const rusty = room.memory.rusty as RustyRoomMemory;
        const { nextSpawnTime } = rusty;
        if (nextSpawnTime == null || Game.time >= nextSpawnTime) {
            rusty.nextSpawnTime = Game.time + _.random(5, 15);
            const spawns = room.find(FIND_MY_SPAWNS);
            const sources = room.find(FIND_SOURCES_ACTIVE);
            const creeps = room.find(FIND_MY_CREEPS);
            const expectedCollectors = [2, Math.round(spawns.length + sources.length)];
            const { controller } = room;
            if (controller?.my) {
                const progressRemaining = controller.progressTotal - controller.progress;
                if (progressRemaining < 100)
                    expectedCollectors.push(5);
                else if (progressRemaining < 1000)
                    expectedCollectors.push(30);
                else if (progressRemaining < 10000)
                    expectedCollectors.push(50);
                else
                    expectedCollectors.push(80);
            }
            const collectors = _(creeps).filter(c => isSpecializedCreepOf(c, CollectorCreep)).size();
            const expc = Math.max(...expectedCollectors)
            room.visual.text(`Collectors: ${collectors}/${expectedCollectors}.`, 0, 0);
            if (collectors < expc) {
                // Spawn collectors if necessary.
                trySpawn(spawns, s => CollectorCreep.spawn(s));
            }
        }
    }
}
