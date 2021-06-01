import _ from "lodash/index";
import { BodyPartProfile, bodyPartProfileToArray } from "src/utility/creep";
import { Logger } from "src/utility/logger";
import { buildCreepMemory, SpecializedSpawnCreepErrorCode } from "./base";
import { randomApprenticeName, randomLeaderName, randomWarriorName } from "./nameGenerator";

const logger = new Logger("Rusty.SpecializedCreeps.Spawn");

export function initializeCreepMemory<TState extends Record<string, any> = {}>(creepName: string, rustyType: string, state: TState): void {
    // Note that the creep just started spawning is not visible at current frame.
    // const { spawning } = spawn;
    // if (!spawning) throw new Error("No spawnning object.");
    if (Memory.creeps[creepName]) {
        // Dead creep did not clean up.
        logger.info(`initializeCreepMemory: Overwriting creep memory: ${creepName}`);
    }
    Memory.creeps[creepName] = buildCreepMemory(rustyType, state);
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
