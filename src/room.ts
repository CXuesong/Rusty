import wu from "wu";
import { trySpawn } from "./spawn";
import { CollectorCreep } from "./specializedCreeps/collector";

export function onNextFrame(): void {
    for (const room of wu.values(Game.rooms)) {
        const spawns = room.find(FIND_MY_SPAWNS);
        const creeps = room.find(FIND_MY_CREEPS);
        if (!creeps.length && !spawns.find(s => s.spawning)) {
            // Keep 1 creep in a room at least.
            trySpawn(spawns, s => CollectorCreep.spawn(s));
        }
    }
}
