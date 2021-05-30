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
const populationIndicatorText = new Map<string, string>();

export function onRoomNextFrame(room: Room): void {
    if (typeof room.memory.rusty !== "object") room.memory.rusty = {};
    const rusty = room.memory.rusty as RustyRoomMemory;
    const towers = room.find(FIND_MY_STRUCTURES, { filter: { structureType: STRUCTURE_TOWER } }) as StructureTower[];
    if (towers.length) {
        var hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length) {
            var username = hostiles[0].owner.username;
            Game.notify(`User ${username} spotted in room ${room.name}`);
            towers.forEach(tower => tower.attack(_(hostiles).first()!));
        }
    }
    const { nextSpawnTime } = rusty;
    if (nextSpawnTime == null || Game.time >= nextSpawnTime) {
        rusty.nextSpawnTime = Game.time + _.random(3, 10);
        // Find available spawns.
        const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
        if (spawns.length) {
            const { controller } = room;
            const sources = room.find(FIND_SOURCES_ACTIVE);
            const creeps = room.find(FIND_MY_CREEPS);
            const defenders = _(creeps).filter(c => isSpecializedCreepOf(c, DefenderCreep)).size();
            const collectors = _(creeps).filter(c => isSpecializedCreepOf(c, CollectorCreep)).size();
            // Do not need to spawn defender under safe mode.
            if (collectors >= 1 && (!controller?.safeMode || controller.safeMode < 1500)) {
                if (defenders < 1) {
                    // Note: if you spawn twice, only the last spawn will be kept.
                    spawns.remove(trySpawn(spawns, s => DefenderCreep.spawn(s)));
                } else {
                    const hostileCreeps = room.find(FIND_HOSTILE_CREEPS).length;
                    if (hostileCreeps > 0 && defenders < hostileCreeps + 1) {
                        spawns.remove(trySpawn(spawns, s => DefenderCreep.spawn(s)));
                    }
                }
            }
            const expectedCollectors = [2,
                spawns.length * 3
                + sources.length * 8
                + (controller?.my ? 6 : 0)
                + 4
            ];
            if (controller?.my) {
                const progressRemaining = controller.progressTotal - controller.progress;
                if (progressRemaining < 1000)
                    expectedCollectors.push(15);
                else if (progressRemaining < 5000)
                    expectedCollectors.push(20);
                else
                    expectedCollectors.push(25);
            }
            const expc = Math.max(...expectedCollectors);
            if (collectors < expc) {
                // Spawn collectors if necessary.
                spawns.remove(trySpawn(spawns, s => CollectorCreep.spawn(s)));
            }

            // Update room indicator
            const decayingCreeps = _(creeps).sortBy(c => c.ticksToLive)
                .take(5).map(c => `  ${c.name}\t${c.ticksToLive}tks`)
                .join("\n");
            populationIndicatorText.set(room.name, `
Defenders: ${defenders}
Collectors: ${collectors}/[${expectedCollectors}].
Decaying creeps
${decayingCreeps}
`.trim());
        }
    }
}

export function onNextFrame(): void {
    for (const room of _(Game.rooms).values()) {
        try {
            onRoomNextFrame(room);
            const populationIndicator = populationIndicatorText.get(room.name);
            if (populationIndicator) {
                populationIndicator.split("\n").forEach((l, i) =>
                    room.visual.text(l, 1, 1 + i, { align: "left", opacity: 0.4 })
                );
            }
        } catch (err) {
            logger.error(`onNextFrame failed in ${room}.`, err);
        }
    }
}
