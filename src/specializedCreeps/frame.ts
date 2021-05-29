import _ from "lodash";
import { Logger } from "src/utility/logger";
import { CollectorCreep } from "./collector";
import { getSpecializedCreep, knownCreepTypes } from "./registry";

const logger = new Logger("Rusty.SpecializedCreeps");

knownCreepTypes.push(
    CollectorCreep
);

function houseKeeping() {
    const deleted: string[] = [];
    for (const k of Object.keys(Memory.creeps)) {
        if (!(k in Game.creeps)) {
            deleted.push(k);
            delete Memory.creeps[k];
        }
    }
    if (deleted.length)
        logger.info(`houseKeeping: deleted ${deleted.length} creep memory: ${deleted}.`);
}

let nextHouseKeepingTime = 0;

export function onNextFrame() {
    // Drive the creeps
    for (const creep of _(Game.creeps).values()) {
        const sc = getSpecializedCreep(creep);
        if (!sc) continue;
        const { ticksToLive } = creep;
        try {
            if (ticksToLive != null && ticksToLive <= 1) {
                sc.dispose();
            } else {
                sc.nextFrame();
            }
        } catch (err) {
            logger.error(`onNextFrame failed in ${creep}.`, err);
        }
    }
    // Housekeeping
    if (Game.time >= nextHouseKeepingTime) {
        nextHouseKeepingTime = Game.time + 100;
        houseKeeping();
    }
}
