import _ from "lodash/index";
import { getRustyMemory } from "src/memory";
import { buildCreepMemory, SpecializedSpawnCreepErrorCode } from "./base";
import { randomApprenticeName, randomLeaderName, randomWarriorName } from "./nameGenerator";

export function initializeCreepMemory<TState extends Record<string, any> = {}>(spawn: StructureSpawn, creepName: string, rustyType: string, state: TState): void {
    // Note that the creep just started spawning is not visible at current frame.
    // const { spawning } = spawn;
    // if (!spawning) throw new Error("No spawnning object.");
    getRustyMemory().spawningCreeps[spawn.name] = { creep: creepName, memory: buildCreepMemory(rustyType, state) };
}

export function spawnCreep(spawn: StructureSpawn,
    body: BodyPartConstant[] | Partial<Record<BodyPartConstant, number>>,
    options?: SpawnOptions): string | SpecializedSpawnCreepErrorCode {
    if (!Array.isArray(body)) body = _(body).flatMap((count, part) => _(count).times(() => part as BodyPartConstant)).value();
    if (spawn.spawning) {
        console.log(`spawnCreep: Spawn ${spawn.name} is currently spawning ${spawn.spawning.name} (ETA ${spawn.spawning.remainingTime} ticks).`);
        return ERR_BUSY;
    }
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
