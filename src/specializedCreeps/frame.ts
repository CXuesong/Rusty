import _ from "lodash";
import { Logger } from "src/utility/logger";
import { CollectorCreep, houseKeeping as collectorHouseKeeping } from "./collector";
import { DefenderCreep } from "./defender";
import { getSpecializedCreep, houseKeeping as registryHouseKeeping, knownCreepTypes } from "./registry";

const logger = new Logger("Rusty.SpecializedCreeps.Frame");

knownCreepTypes.push(
    CollectorCreep,
    DefenderCreep,
);

function houseKeeping() {
    // Delete leaked creep memory.
    // Not necessary: Game has already done that for us.
    // const deleted: string[] = [];
    // for (const k of Object.keys(Memory.creeps)) {
    //     if (!(k in Game.creeps)) {
    //         deleted.push(k);
    //         delete Memory.creeps[k];
    //     }
    // }
    // if (deleted.length)
    //     logger.info(`houseKeeping: deleted ${deleted.length} creep memory: ${deleted}.`);
}

let nextHouseKeepingTime = 0;

export function onNextFrame() {
    // Drive the creeps
    for (const creep of _(Game.creeps).values()) {
        try {
            const sc = getSpecializedCreep(creep);
            if (!sc) continue;
            const { ticksToLive } = creep;
            if (ticksToLive != null && ticksToLive <= 3) {
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
        nextHouseKeepingTime = Game.time + _.random(5);
        logger.info(`Housekeeping. Next housekeeping time: ${nextHouseKeepingTime}.`);
        // Order is important to ensure proper disposal.
        registryHouseKeeping(logger);
        collectorHouseKeeping(logger);
        houseKeeping();
    }
}
