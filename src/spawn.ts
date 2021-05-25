export function trySpawn(spawns: Iterable<StructureSpawn>, spawnFunc: (spawn: StructureSpawn) => string | ScreepsReturnCode): StructureSpawn | undefined {
    let count = 0;
    let lastError: ScreepsReturnCode | undefined;
    for (const spawn of spawns) {
        const result = spawnFunc(spawn);
        if (result === OK || typeof result === "string") return spawn;
        count++;
        lastError = result;
    }
    console.log(`trySpawn: All attempts exhausted in ${count} spawns. Last error: ${lastError}.`)
    return undefined;
}
