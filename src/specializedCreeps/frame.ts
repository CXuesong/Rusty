import _ from "lodash";
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
    // Drive the creeps
    for (const creep of _(Game.creeps).values()) {
        const sc = getSpecializedCreep(creep);
        if (!sc) continue;
        const { ticksToLive } = creep;
        if (ticksToLive != null && ticksToLive <= 1) {
            sc.dispose();
        } else {
            sc.nextFrame();
        }
    }
}
