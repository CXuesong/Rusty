import _ from "lodash/index";
import { randomApprenticeName, randomLeaderName, randomWarriorName } from "src/creeps/nameGenerator";
import { BodyPartProfile, bodyPartProfileToArray } from "src/creeps/utility";
import { Logger } from "../utility/logger";

export type SpecializedSpawnCreepErrorCode = Exclude<ScreepsReturnCode, OK | ERR_NAME_EXISTS>;

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


export interface SpawnOptionsEx extends SpawnOptions {
    namePrefix?: string;
}

export function spawnCreep(spawn: StructureSpawn,
    body: BodyPartConstant[] | BodyPartProfile,
    options?: SpawnOptionsEx): string | SpecializedSpawnCreepErrorCode {
    if (!Array.isArray(body)) body = bodyPartProfileToArray(body);
    if (spawn.spawning) {
        logger.warning(`spawnCreep: Spawn ${spawn.name} is currently spawning ${spawn.spawning.name} (ETA ${spawn.spawning.remainingTime} ticks).`);
        return ERR_BUSY;
    }
    const { namePrefix = "", ...rawOptions } = options || {};
    let name: string;
    const result = ((): Exclude<ScreepsReturnCode, ERR_NAME_EXISTS> => {
        let r: ScreepsReturnCode;
        if ((r = spawn.spawnCreep(body, name = namePrefix + randomWarriorName(), rawOptions)) !== ERR_NAME_EXISTS) return r;
        if ((r = spawn.spawnCreep(body, name = namePrefix + randomWarriorName(), rawOptions)) !== ERR_NAME_EXISTS) return r;
        if ((r = spawn.spawnCreep(body, name = namePrefix + randomApprenticeName(), rawOptions)) !== ERR_NAME_EXISTS) return r;
        if ((r = spawn.spawnCreep(body, name = namePrefix + randomLeaderName(), rawOptions)) !== ERR_NAME_EXISTS) return r;
        if ((r = spawn.spawnCreep(body, name = namePrefix + randomWarriorName() + _.random(999999999), options)) !== ERR_NAME_EXISTS) return r;
        throw new Error("Creep name exhausted.");
    })();
    return result === OK ? name : result;
}
