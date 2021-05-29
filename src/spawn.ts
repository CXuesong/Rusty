import { Logger } from "./utility/logger";

const logger = new Logger("Rusty.Spawn");

export function trySpawn(spawns: Iterable<StructureSpawn>, spawnFunc: (spawn: StructureSpawn) => string | ScreepsReturnCode): StructureSpawn | undefined {
    let count = 0;
    let lastResult: [StructureSpawn, ScreepsReturnCode] | undefined;
    for (const spawn of spawns) {
        const result = spawnFunc(spawn);
        if (result === OK || typeof result === "string") return spawn;
        count++;
        lastResult = [spawn, result];
    }
    if (lastResult)
        logger.warning(`trySpawn: All attempts exhausted in ${count} spawns. Last result: ${lastResult[1]} on ${lastResult[0]}.`);
    else
        logger.warning("trySpawn: spawns list is empty.");
    return undefined;
}
