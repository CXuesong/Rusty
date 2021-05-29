import _ from "lodash";
import { Logger } from "src/utility/logger";
import { SpecializedCreepBase } from "./base";
import { CollectorCreep } from "./collector";

const logger = new Logger("Rusty.SpecializedCreeps");
const creepCache = new WeakMap<Creep, SpecializedCreepBase>();

function getNewSpecializedCreepInst(creep: Creep): SpecializedCreepBase | undefined {
    switch (creep.memory.rustyType) {
        case CollectorCreep.rustyType:
            return new CollectorCreep(creep);
        default:
            // Unknown creep
            return undefined;
    }
}

export function getSpecializedCreep(creep: Creep): SpecializedCreepBase | undefined {
    let c = creepCache.get(creep);
    if (!c) {
        c = getNewSpecializedCreepInst(creep);
        if (c) creepCache.set(creep, c);
    }
    return c;
}

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
}
