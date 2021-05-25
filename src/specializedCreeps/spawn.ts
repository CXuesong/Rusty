import { getRustyMemory } from "src/memory";
import wu from "wu";
import { buildCreepMemory, SpecializedSpawnCreepErrorCode } from "./base";
import { randomApprenticeName, randomLeaderName, randomWarriorName } from "./nameGenerator";

export function initializeCreepMemory<TState extends Record<string, any> = {}>(spawn: StructureSpawn, rustyType: string, state: TState): void {
    const { spawning } = spawn;
    if (!spawning) throw new Error("No spawnning object.");
    getRustyMemory().spawningCreeps[spawn.name] = { creep: spawning.name, memory: buildCreepMemory(rustyType, state) };
}

export function spawnCreep(spawn: StructureSpawn,
    body: BodyPartConstant[] | Partial<Record<BodyPartConstant, number>>,
    options?: SpawnOptions): string | SpecializedSpawnCreepErrorCode {
    if (!Array.isArray(body)) body = wu(Object.entries(body)).concatMap(([part, count]) => wu.repeat(part as BodyPartConstant, count)).toArray();
    if (spawn.spawning) throw new Error(`Spawn ${spawn.name} is currently spawning ${spawn.spawning.name} (ETA ${spawn.spawning.remainingTime} ticks).`);
    let name: string;
    const result = ((): Exclude<ScreepsReturnCode, ERR_NAME_EXISTS> => {
        let r: ScreepsReturnCode;
        if ((r = spawn.spawnCreep(body, name = randomWarriorName(), options)) !== ERR_NAME_EXISTS) return r;
        if ((r = spawn.spawnCreep(body, name = randomWarriorName(), options)) !== ERR_NAME_EXISTS) return r;
        if ((r = spawn.spawnCreep(body, name = randomApprenticeName(), options)) !== ERR_NAME_EXISTS) return r;
        if ((r = spawn.spawnCreep(body, name = randomLeaderName(), options)) !== ERR_NAME_EXISTS) return r;
        for (let i = 0; i < 10; i++) {
            if ((r = spawn.spawnCreep(body, name = randomWarriorName() + _.random(999999999), options)) !== ERR_NAME_EXISTS) return r;
            if ((r = spawn.spawnCreep(body, name = randomApprenticeName() + _.random(999999999), options)) !== ERR_NAME_EXISTS) return r;
            if ((r = spawn.spawnCreep(body, name = randomLeaderName() + _.random(999999999), options)) !== ERR_NAME_EXISTS) return r;
        }
        throw new Error("Creep name exhausted.");
    })();
    return result === OK ? name : result;
}
