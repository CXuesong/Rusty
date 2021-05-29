import _ from "lodash";
import { trySpawn } from "./spawn";
import { isSpecializedCreepOf } from "./specializedCreeps";
import { CollectorCreep } from "./specializedCreeps/collector";
import { DefenderCreep } from "./specializedCreeps/defender";
import { Logger } from "./utility/logger";

interface RustyRoomMemory {
    nextSpawnTime?: number;
}

const logger = new Logger("Rusty.Room");

export function onRoomNextFrame(room: Room): void {
    if (typeof room.memory.rusty !== "object") room.memory.rusty = {};
    const rusty = room.memory.rusty as RustyRoomMemory;
    const { nextSpawnTime } = rusty;
    if (nextSpawnTime == null || Game.time >= nextSpawnTime) {
        rusty.nextSpawnTime = Game.time + _.random(3, 10);
        // Find available spawns.
        const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
        if (spawns.length) {
            const sources = room.find(FIND_SOURCES_ACTIVE);
            const creeps = room.find(FIND_MY_CREEPS);
            const defenders = _(creeps).filter(c => isSpecializedCreepOf(c, DefenderCreep)).size();
            if (defenders < 1) {
                trySpawn(spawns, s => DefenderCreep.spawn(s));
                return;
            } else {
                const hostileCreeps = room.find(FIND_HOSTILE_CREEPS).length;
                if (hostileCreeps > 0 && defenders < hostileCreeps + 1) {
                    trySpawn(spawns, s => DefenderCreep.spawn(s));
                    return;
                }
            }
            const expectedCollectors = [2, (spawns.length + sources.length) * 8];
            const { controller } = room;
            if (controller?.my) {
                const progressRemaining = controller.progressTotal - controller.progress;
                if (progressRemaining < 1000)
                    expectedCollectors.push(10);
                else if (progressRemaining < 5000)
                    expectedCollectors.push(20);
                else
                    expectedCollectors.push(40);
            }
            const collectors = _(creeps).filter(c => isSpecializedCreepOf(c, CollectorCreep)).size();
            const expc = Math.max(...expectedCollectors)
            room.visual.text(`Collectors: ${collectors}/[${expectedCollectors}].`, 0, 0, { align: "left" });
            if (collectors < expc) {
                // Spawn collectors if necessary.
                trySpawn(spawns, s => CollectorCreep.spawn(s));
            }
        }
    }
}

export function onNextFrame(): void {
    for (const room of _(Game.rooms).values()) {
        try {
            onRoomNextFrame(room);
        } catch (err) {
            logger.error(`onNextFrame failed in ${room}.`, err);
        }
    }
}
